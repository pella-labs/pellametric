import { beforeEach, describe, expect, test } from "bun:test";
import {
  fingerprintPublicKey,
  generateTestKeypair,
  parsePublicKeysEnv,
  type SignedConfigEnvelope,
  type SignedConfigPayload,
  signConfig,
} from "@bematist/config";
import { InMemoryAlertEmitter, InMemoryAuditWriter } from "./audit";
import { COOLDOWN_WINDOW_MS } from "./cooldown";
import { handlePolicyFlip, type PolicyFlipDeps } from "./handler";
import { defaultPolicyRow, InMemoryPolicyFlipStore } from "./store";

const ORG = "00000000-0000-4000-8000-000000000001";
const ADMIN_USER = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-04-17T12:00:00.000Z");

interface Fixtures {
  publicKeyRaw: Uint8Array;
  privateKey: CryptoKey;
  store: InMemoryPolicyFlipStore;
  audit: InMemoryAuditWriter;
  alerts: InMemoryAlertEmitter;
  deps: PolicyFlipDeps;
}

async function setup(opts: { now?: Date } = {}): Promise<Fixtures> {
  const { publicKeyRaw, privateKey } = await generateTestKeypair();
  const store = new InMemoryPolicyFlipStore();
  store.seed(ORG, defaultPolicyRow(ORG));
  const audit = new InMemoryAuditWriter();
  const alerts = new InMemoryAlertEmitter();
  const fixedNow = opts.now ?? NOW;
  const deps: PolicyFlipDeps = {
    store,
    audit,
    alerts,
    publicKeysRaw: [publicKeyRaw],
    now: () => fixedNow,
  };
  return { publicKeyRaw, privateKey, store, audit, alerts, deps };
}

async function makeEnvelope(input: {
  publicKeyRaw: Uint8Array;
  privateKey: CryptoKey;
  override?: Partial<SignedConfigPayload>;
}): Promise<{ envelope: SignedConfigEnvelope; payload: SignedConfigPayload }> {
  const fp = await fingerprintPublicKey(input.publicKeyRaw);
  const payload: SignedConfigPayload = {
    tenant_id: ORG,
    action: "tier_c_admin_flip",
    previous_tier: "B",
    new_tier: "C",
    issued_at: new Date(NOW.getTime() - 60_000).toISOString(),
    nonce: crypto.randomUUID(),
    signer_fingerprint: fp,
    ...input.override,
  };
  const envelope = await signConfig(payload, input.privateKey);
  return { envelope, payload };
}

describe("handlePolicyFlip — happy path", () => {
  test("valid signature + first activation → ok=true, row activated, audit + alert emitted", async () => {
    const fx = await setup();
    const { envelope, payload } = await makeEnvelope(fx);
    const res = await handlePolicyFlip(
      {
        envelope,
        caller: { user_id: ADMIN_USER, org_id: ORG },
        request_id: "req-1",
      },
      fx.deps,
    );

    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("unreachable");
    expect(res.row.tier_c_managed_cloud_optin).toBe(true);
    expect(res.row.tier_c_activated_at).toEqual(NOW);
    expect(res.row.tier_c_signed_config).toBeTruthy();
    expect(res.payload).toEqual(payload);

    expect(fx.audit.rows).toHaveLength(1);
    const a = fx.audit.rows[0];
    expect(a).toBeDefined();
    if (!a) throw new Error("unreachable");
    expect(a.action).toBe("tier_c_admin_flip");
    expect(a.target_type).toBe("policy");
    expect(a.target_id).toBe(ORG);
    expect(a.org_id).toBe(ORG);
    expect(a.actor_user_id).toBe(ADMIN_USER);
    expect(a.metadata_json.signer_fingerprint).toBe(res.signer_fingerprint);
    expect(a.metadata_json.previous_tier).toBe("B");
    expect(a.metadata_json.new_tier).toBe("C");
    expect(a.metadata_json.nonce).toBe(payload.nonce);
    expect(a.metadata_json.issued_at).toBe(payload.issued_at);
    expect(a.metadata_json.request_id).toBe("req-1");

    expect(fx.alerts.rows).toHaveLength(1);
    const al = fx.alerts.rows[0];
    expect(al).toBeDefined();
    if (!al) throw new Error("unreachable");
    expect(al.kind).toBe("policy_flip");
    expect(al.signal).toBe("tier_c_activated");
    expect(al.org_id).toBe(ORG);
    expect(al.dev_id_hash).toBeNull();
  });

  test("flip after cooldown elapsed → second activation succeeds", async () => {
    const fx = await setup();
    fx.store.seed(ORG, {
      ...defaultPolicyRow(ORG),
      tier_c_activated_at: new Date(NOW.getTime() - COOLDOWN_WINDOW_MS - 1),
      tier_c_managed_cloud_optin: true,
    });
    const { envelope } = await makeEnvelope(fx);
    const res = await handlePolicyFlip(
      {
        envelope,
        caller: { user_id: ADMIN_USER, org_id: ORG },
        request_id: "req-after-cooldown",
      },
      fx.deps,
    );
    expect(res.ok).toBe(true);
  });
});

describe("handlePolicyFlip — signature rejection", () => {
  test("envelope tampered after signing → 401 SIGNATURE_REJECTED", async () => {
    const fx = await setup();
    const { envelope, payload } = await makeEnvelope(fx);
    // Re-encode a different valid payload with the original signature.
    const tampered = { ...payload, nonce: "nonce-attacker" };
    const tamperedB64 = Buffer.from(JSON.stringify(tampered)).toString("base64url");
    const tamperedEnv = { payload: tamperedB64, signature: envelope.signature };

    const res = await handlePolicyFlip(
      {
        envelope: tamperedEnv,
        caller: { user_id: ADMIN_USER, org_id: ORG },
        request_id: "req-tamper",
      },
      fx.deps,
    );
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.status).toBe(401);
    expect(res.code).toBe("SIGNATURE_REJECTED");
    expect(fx.audit.rows).toHaveLength(0);
    expect(fx.alerts.rows).toHaveLength(0);
    // Activation must NOT have happened.
    expect(fx.store.peek(ORG)?.tier_c_managed_cloud_optin).toBe(false);
  });

  test("signed by attacker (not pinned) → 401 SIGNATURE_REJECTED FINGERPRINT_MISMATCH", async () => {
    const fx = await setup();
    const attackerKp = await generateTestKeypair();
    const fp = await fingerprintPublicKey(attackerKp.publicKeyRaw);
    const payload: SignedConfigPayload = {
      tenant_id: ORG,
      action: "tier_c_admin_flip",
      previous_tier: "B",
      new_tier: "C",
      issued_at: new Date(NOW.getTime() - 60_000).toISOString(),
      nonce: "n-attack",
      signer_fingerprint: fp,
    };
    const envelope = await signConfig(payload, attackerKp.privateKey);
    const res = await handlePolicyFlip(
      { envelope, caller: { user_id: ADMIN_USER, org_id: ORG }, request_id: "req-attacker" },
      fx.deps,
    );
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.status).toBe(401);
    expect(res.reason).toBe("FINGERPRINT_MISMATCH");
  });

  test("malformed envelope (missing signature) → 400 SIGNATURE_REJECTED MALFORMED_ENVELOPE", async () => {
    const fx = await setup();
    const res = await handlePolicyFlip(
      {
        envelope: { payload: "abc" } as unknown as { payload: string; signature: string },
        caller: { user_id: ADMIN_USER, org_id: ORG },
        request_id: "req-malformed",
      },
      fx.deps,
    );
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.status).toBe(400);
    expect(res.reason).toBe("MALFORMED_ENVELOPE");
  });

  test("no pinned keys configured → 500 SIGNED_CONFIG_NO_KEYS", async () => {
    const fx = await setup();
    const noKeyDeps: PolicyFlipDeps = { ...fx.deps, publicKeysRaw: [] };
    const { envelope } = await makeEnvelope(fx);
    const res = await handlePolicyFlip(
      {
        envelope,
        caller: { user_id: ADMIN_USER, org_id: ORG },
        request_id: "req-no-keys",
      },
      noKeyDeps,
    );
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.status).toBe(500);
    expect(res.code).toBe("SIGNED_CONFIG_NO_KEYS");
  });
});

describe("handlePolicyFlip — cooldown enforcement", () => {
  test("activated 1 day ago → 403 COOLDOWN_NOT_ELAPSED with retry_after_ms", async () => {
    const fx = await setup();
    const oneDayAgo = new Date(NOW.getTime() - 24 * 60 * 60 * 1000);
    fx.store.seed(ORG, {
      ...defaultPolicyRow(ORG),
      tier_c_activated_at: oneDayAgo,
      tier_c_managed_cloud_optin: true,
    });
    const { envelope } = await makeEnvelope(fx);
    const res = await handlePolicyFlip(
      {
        envelope,
        caller: { user_id: ADMIN_USER, org_id: ORG },
        request_id: "req-cooldown",
      },
      fx.deps,
    );
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.status).toBe(403);
    expect(res.code).toBe("COOLDOWN_NOT_ELAPSED");
    expect(res.reason).toContain("retry_after_ms=");
    const remainingMs = Number.parseInt(res.reason?.split("=")[1] ?? "0", 10);
    expect(remainingMs).toBeGreaterThan(0);
    expect(remainingMs).toBeLessThanOrEqual(COOLDOWN_WINDOW_MS);
    // No audit/alert/activation on rejection.
    expect(fx.audit.rows).toHaveLength(0);
    expect(fx.alerts.rows).toHaveLength(0);
  });

  test("activated exactly 7 days ago → cooldown elapsed, accept", async () => {
    const fx = await setup();
    const sevenDaysAgo = new Date(NOW.getTime() - COOLDOWN_WINDOW_MS);
    fx.store.seed(ORG, {
      ...defaultPolicyRow(ORG),
      tier_c_activated_at: sevenDaysAgo,
      tier_c_managed_cloud_optin: true,
    });
    const { envelope } = await makeEnvelope(fx);
    const res = await handlePolicyFlip(
      {
        envelope,
        caller: { user_id: ADMIN_USER, org_id: ORG },
        request_id: "req-edge",
      },
      fx.deps,
    );
    expect(res.ok).toBe(true);
  });

  test("activated 6 days 23 hours ago → still rejected", async () => {
    const fx = await setup();
    const justUnder = new Date(NOW.getTime() - COOLDOWN_WINDOW_MS + 60 * 60 * 1000);
    fx.store.seed(ORG, {
      ...defaultPolicyRow(ORG),
      tier_c_activated_at: justUnder,
      tier_c_managed_cloud_optin: true,
    });
    const { envelope } = await makeEnvelope(fx);
    const res = await handlePolicyFlip(
      {
        envelope,
        caller: { user_id: ADMIN_USER, org_id: ORG },
        request_id: "req-edge2",
      },
      fx.deps,
    );
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.code).toBe("COOLDOWN_NOT_ELAPSED");
  });
});

describe("handlePolicyFlip — tenant + tier transition guards", () => {
  test("envelope tenant_id ≠ caller org → 403 TENANT_MISMATCH", async () => {
    const fx = await setup();
    const { envelope } = await makeEnvelope({
      ...fx,
      override: { tenant_id: "00000000-0000-4000-8000-000000000099" },
    });
    const res = await handlePolicyFlip(
      {
        envelope,
        caller: { user_id: ADMIN_USER, org_id: ORG },
        request_id: "req-tenant-mismatch",
      },
      fx.deps,
    );
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.status).toBe(403);
    expect(res.code).toBe("TENANT_MISMATCH");
    expect(fx.audit.rows).toHaveLength(0);
  });

  test("envelope previous_tier ≠ live tier_default → 409 INVALID_PREVIOUS_TIER", async () => {
    const fx = await setup();
    fx.store.seed(ORG, {
      ...defaultPolicyRow(ORG),
      tier_default: "A",
    });
    const { envelope } = await makeEnvelope({
      ...fx,
      override: { previous_tier: "B" }, // stale — live row says A
    });
    const res = await handlePolicyFlip(
      {
        envelope,
        caller: { user_id: ADMIN_USER, org_id: ORG },
        request_id: "req-stale",
      },
      fx.deps,
    );
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.status).toBe(409);
    expect(res.code).toBe("INVALID_PREVIOUS_TIER");
  });

  test("missing org policy row → 500 ORG_POLICY_MISSING", async () => {
    const fx = await setup();
    fx.store.clear();
    const { envelope } = await makeEnvelope(fx);
    const res = await handlePolicyFlip(
      {
        envelope,
        caller: { user_id: ADMIN_USER, org_id: ORG },
        request_id: "req-missing",
      },
      fx.deps,
    );
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.status).toBe(500);
    expect(res.code).toBe("ORG_POLICY_MISSING");
  });
});

describe("handlePolicyFlip — env wiring", () => {
  test("parsePublicKeysEnv → handler accepts a valid envelope signed by one of the keys", async () => {
    const goodKp = await generateTestKeypair();
    const otherKp = await generateTestKeypair();
    const env = `${Buffer.from(goodKp.publicKeyRaw).toString("hex")},${Buffer.from(
      otherKp.publicKeyRaw,
    ).toString("hex")}`;
    const keys = parsePublicKeysEnv(env);
    expect(keys).toHaveLength(2);

    const store = new InMemoryPolicyFlipStore();
    store.seed(ORG, defaultPolicyRow(ORG));
    const audit = new InMemoryAuditWriter();
    const alerts = new InMemoryAlertEmitter();
    const deps: PolicyFlipDeps = {
      store,
      audit,
      alerts,
      publicKeysRaw: keys,
      now: () => NOW,
    };

    const fp = await fingerprintPublicKey(goodKp.publicKeyRaw);
    const payload: SignedConfigPayload = {
      tenant_id: ORG,
      action: "tier_c_admin_flip",
      previous_tier: "B",
      new_tier: "C",
      issued_at: new Date(NOW.getTime() - 60_000).toISOString(),
      nonce: "nonce-env",
      signer_fingerprint: fp,
    };
    const envelope = await signConfig(payload, goodKp.privateKey);
    const res = await handlePolicyFlip(
      { envelope, caller: { user_id: ADMIN_USER, org_id: ORG }, request_id: "req-env" },
      deps,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("unreachable");
    expect(res.signer_fingerprint).toBe(fp);
  });
});

describe("audit row shape — invariants", () => {
  let fx: Fixtures;
  beforeEach(async () => {
    fx = await setup();
  });

  test("audit row carries every D20-required field", async () => {
    const { envelope, payload } = await makeEnvelope(fx);
    const res = await handlePolicyFlip(
      {
        envelope,
        caller: { user_id: ADMIN_USER, org_id: ORG },
        request_id: "req-audit",
      },
      fx.deps,
    );
    expect(res.ok).toBe(true);
    expect(fx.audit.rows).toHaveLength(1);
    const row = fx.audit.rows[0];
    expect(row).toBeDefined();
    if (!row) throw new Error("unreachable");

    // D20: signer fingerprint, tenant, timestamp, previous tier, new tier.
    expect(row.metadata_json.signer_fingerprint).toMatch(/^[0-9a-f]{16}$/);
    expect(row.org_id).toBe(ORG);
    expect(row.target_id).toBe(ORG);
    expect(row.ts).toEqual(NOW);
    expect(row.metadata_json.previous_tier).toBe(payload.previous_tier);
    expect(row.metadata_json.new_tier).toBe(payload.new_tier);
    // Plus nonce + issued_at + request_id for forensic reconstruction.
    expect(row.metadata_json.nonce).toBe(payload.nonce);
    expect(row.metadata_json.issued_at).toBe(payload.issued_at);
    expect(row.metadata_json.request_id).toBe("req-audit");
  });
});
