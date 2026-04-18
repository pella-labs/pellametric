import { beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  fingerprintPublicKey,
  generateTestKeypair,
  type SignedConfigEnvelope,
  type SignedConfigPayload,
  signConfig,
} from "@bematist/config";
import { permissiveRateLimiter } from "../auth/rateLimit";
import type { IngestKeyRow, IngestKeyStore } from "../auth/verifyIngestKey";
import { LRUCache } from "../auth/verifyIngestKey";
import { resetDeps, setDeps } from "../deps";
import { handle } from "../server";
import { InMemoryAlertEmitter, InMemoryAuditWriter } from "./audit";
import { COOLDOWN_WINDOW_MS } from "./cooldown";
import type { PolicyFlipDeps } from "./handler";
import { defaultPolicyRow, InMemoryPolicyFlipStore } from "./store";

// Bearer format is bm_<orgId>_<keyId>_<secret> — orgId matches [A-Za-z0-9]+
// (no dashes). The in-memory PolicyFlipStore is tenant-opaque so any stable
// string works; audit_log.org_id UUID typing only applies to the Drizzle
// impl, which is exercised separately via manual integration.
const ORG = "orgadminflip";
const ADMIN_USER = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-04-17T12:00:00.000Z");

function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

function makeKeyStore(): IngestKeyStore {
  const row: IngestKeyRow = {
    id: "adminkey",
    org_id: ORG,
    engineer_id: "eng_admin",
    key_sha256: hashSecret("abc"),
    tier_default: "B",
    revoked_at: null,
  };
  const byKey = new Map<string, IngestKeyRow>();
  byKey.set(`${row.org_id}/${row.id}`, row);
  byKey.set(`${row.org_id}/*`, row);
  return {
    async get(orgId, keyId) {
      if (keyId === "*") return byKey.get(`${orgId}/*`) ?? null;
      return byKey.get(`${orgId}/${keyId}`) ?? null;
    },
  };
}

interface Fx {
  publicKeyRaw: Uint8Array;
  privateKey: CryptoKey;
  store: InMemoryPolicyFlipStore;
  audit: InMemoryAuditWriter;
  alerts: InMemoryAlertEmitter;
  deps: PolicyFlipDeps;
}

async function setupFx(opts: { now?: Date } = {}): Promise<Fx> {
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

async function postFlip(body: unknown, auth = `Bearer bm_${ORG}_adminkey_abc`): Promise<Response> {
  return handle(
    new Request("http://localhost/v1/admin/policy-flip", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: auth },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

async function wireDeps(fx: Fx): Promise<void> {
  // Rebuild the bearer key store so the legacy 3-segment token bm_<org>_<keyId>_<secret>
  // lines up with the UUID-based ORG constant. Tests run against handle() directly,
  // so all deps live under setDeps.
  const row: IngestKeyRow = {
    id: "adminkey",
    org_id: ORG,
    engineer_id: null,
    key_sha256: hashSecret("abc"),
    tier_default: "B",
    revoked_at: null,
  };
  const byKey = new Map<string, IngestKeyRow>();
  byKey.set(`${ORG}/adminkey`, row);
  const store: IngestKeyStore = {
    async get(orgId, keyId) {
      if (keyId === "*") return null;
      return byKey.get(`${orgId}/${keyId}`) ?? null;
    },
  };
  setDeps({
    store,
    cache: new LRUCache({ max: 1000, ttlMs: 60_000 }),
    rateLimiter: permissiveRateLimiter(),
    policyFlip: fx.deps,
  });
}

describe("POST /v1/admin/policy-flip", () => {
  beforeEach(() => {
    resetDeps();
  });

  test("405 on non-POST", async () => {
    await wireDeps(await setupFx());
    const res = await handle(new Request("http://localhost/v1/admin/policy-flip"));
    expect(res.status).toBe(405);
  });

  test("401 without Authorization", async () => {
    await wireDeps(await setupFx());
    const res = await handle(
      new Request("http://localhost/v1/admin/policy-flip", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ actor_user_id: ADMIN_USER }),
      }),
    );
    expect(res.status).toBe(401);
  });

  test("500 POLICY_FLIP_NOT_CONFIGURED when deps not wired (only key store wired)", async () => {
    // Wire just the bearer auth, leave policyFlip null.
    setDeps({
      store: makeKeyStore(),
      cache: new LRUCache({ max: 1000, ttlMs: 60_000 }),
      rateLimiter: permissiveRateLimiter(),
      policyFlip: null,
    });
    const fx = await setupFx();
    const { envelope } = await makeEnvelope(fx);
    const res = await postFlip({ envelope, actor_user_id: ADMIN_USER });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("POLICY_FLIP_NOT_CONFIGURED");
  });

  test("400 BAD_JSON on invalid body", async () => {
    await wireDeps(await setupFx());
    const res = await postFlip("{not json");
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("BAD_JSON");
  });

  test("400 BAD_SHAPE when envelope missing", async () => {
    await wireDeps(await setupFx());
    const res = await postFlip({ actor_user_id: ADMIN_USER });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("BAD_SHAPE");
  });

  test("400 BAD_SHAPE when actor_user_id missing", async () => {
    const fx = await setupFx();
    await wireDeps(fx);
    const { envelope } = await makeEnvelope(fx);
    const res = await postFlip({ envelope });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("BAD_SHAPE");
  });

  test("400 BAD_SHAPE when actor_user_id not a UUID", async () => {
    const fx = await setupFx();
    await wireDeps(fx);
    const { envelope } = await makeEnvelope(fx);
    const res = await postFlip({ envelope, actor_user_id: "not-a-uuid" });
    expect(res.status).toBe(400);
  });

  test("200 on valid signed payload → audit + alert emitted, tier flipped", async () => {
    const fx = await setupFx();
    await wireDeps(fx);
    const { envelope, payload } = await makeEnvelope(fx);
    const res = await postFlip({ envelope, actor_user_id: ADMIN_USER });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      signer_fingerprint: string;
      activated_at: string;
    };
    expect(body.ok).toBe(true);
    expect(body.signer_fingerprint).toMatch(/^[0-9a-f]{16}$/);
    expect(body.activated_at).toBe(NOW.toISOString());

    // Policy row flipped
    const peeked = fx.store.peek(ORG);
    expect(peeked?.tier_c_managed_cloud_optin).toBe(true);
    expect(peeked?.tier_c_activated_at).toEqual(NOW);
    expect(peeked?.tier_c_signed_config).toBeTruthy();

    // Audit row written
    expect(fx.audit.rows).toHaveLength(1);
    const audit = fx.audit.rows[0];
    expect(audit).toBeDefined();
    if (!audit) throw new Error("unreachable");
    expect(audit.action).toBe("tier_c_admin_flip");
    expect(audit.target_type).toBe("policy");
    expect(audit.target_id).toBe(ORG);
    expect(audit.actor_user_id).toBe(ADMIN_USER);
    expect(audit.metadata_json.nonce).toBe(payload.nonce);

    // Alert row emitted — this is the SSE trigger (the real DrizzleAlertEmitter
    // fires pg_notify in addition to the insert; we assert the domain row here).
    expect(fx.alerts.rows).toHaveLength(1);
    const alert = fx.alerts.rows[0];
    expect(alert).toBeDefined();
    if (!alert) throw new Error("unreachable");
    expect(alert.kind).toBe("policy_flip");
    expect(alert.signal).toBe("tier_c_activated");
    expect(alert.org_id).toBe(ORG);
    expect(alert.dev_id_hash).toBeNull();
  });

  test("401 SIGNATURE_REJECTED on tampered signature", async () => {
    const fx = await setupFx();
    await wireDeps(fx);
    const { envelope, payload } = await makeEnvelope(fx);
    const tampered = { ...payload, nonce: "nonce-attacker" };
    const tamperedB64 = Buffer.from(JSON.stringify(tampered)).toString("base64url");
    const tamperedEnv = { payload: tamperedB64, signature: envelope.signature };

    const res = await postFlip({ envelope: tamperedEnv, actor_user_id: ADMIN_USER });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("SIGNATURE_REJECTED");
    // No side effects on rejection
    expect(fx.audit.rows).toHaveLength(0);
    expect(fx.alerts.rows).toHaveLength(0);
    expect(fx.store.peek(ORG)?.tier_c_managed_cloud_optin).toBe(false);
  });

  test("401 FINGERPRINT_MISMATCH when signed by a non-pinned key", async () => {
    const fx = await setupFx();
    await wireDeps(fx);
    const attacker = await generateTestKeypair();
    const fp = await fingerprintPublicKey(attacker.publicKeyRaw);
    const payload: SignedConfigPayload = {
      tenant_id: ORG,
      action: "tier_c_admin_flip",
      previous_tier: "B",
      new_tier: "C",
      issued_at: new Date(NOW.getTime() - 60_000).toISOString(),
      nonce: "n-attack",
      signer_fingerprint: fp,
    };
    const envelope = await signConfig(payload, attacker.privateKey);
    const res = await postFlip({ envelope, actor_user_id: ADMIN_USER });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code: string; reason?: string };
    expect(body.code).toBe("SIGNATURE_REJECTED");
    expect(body.reason).toBe("FINGERPRINT_MISMATCH");
  });

  test("403 COOLDOWN_NOT_ELAPSED with retry_after_ms in JSON body", async () => {
    const fx = await setupFx();
    const oneDayAgo = new Date(NOW.getTime() - 24 * 60 * 60 * 1000);
    fx.store.seed(ORG, {
      ...defaultPolicyRow(ORG),
      tier_c_activated_at: oneDayAgo,
      tier_c_managed_cloud_optin: true,
    });
    await wireDeps(fx);
    const { envelope } = await makeEnvelope(fx);
    const res = await postFlip({ envelope, actor_user_id: ADMIN_USER });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string; retry_after_ms: number };
    expect(body.code).toBe("COOLDOWN_NOT_ELAPSED");
    expect(body.retry_after_ms).toBeGreaterThan(0);
    expect(body.retry_after_ms).toBeLessThanOrEqual(COOLDOWN_WINDOW_MS);
    // No writes on cooldown rejection
    expect(fx.audit.rows).toHaveLength(0);
    expect(fx.alerts.rows).toHaveLength(0);
  });

  test("403 TENANT_MISMATCH when envelope tenant_id ≠ bearer org", async () => {
    const fx = await setupFx();
    await wireDeps(fx);
    const { envelope } = await makeEnvelope({
      ...fx,
      override: { tenant_id: "orgmismatch" },
    });
    const res = await postFlip({ envelope, actor_user_id: ADMIN_USER });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("TENANT_MISMATCH");
  });

  test("409 INVALID_PREVIOUS_TIER when envelope previous_tier ≠ live tier_default", async () => {
    const fx = await setupFx();
    fx.store.seed(ORG, { ...defaultPolicyRow(ORG), tier_default: "A" });
    await wireDeps(fx);
    const { envelope } = await makeEnvelope({ ...fx, override: { previous_tier: "B" } });
    const res = await postFlip({ envelope, actor_user_id: ADMIN_USER });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("INVALID_PREVIOUS_TIER");
  });

  test("500 SIGNED_CONFIG_NO_KEYS when pinned keys empty", async () => {
    const fx = await setupFx();
    const deps: PolicyFlipDeps = { ...fx.deps, publicKeysRaw: [] };
    await wireDeps({ ...fx, deps });
    const { envelope } = await makeEnvelope(fx);
    const res = await postFlip({ envelope, actor_user_id: ADMIN_USER });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("SIGNED_CONFIG_NO_KEYS");
  });

  test("500 ORG_POLICY_MISSING when policy row absent", async () => {
    const fx = await setupFx();
    fx.store.clear();
    await wireDeps(fx);
    const { envelope } = await makeEnvelope(fx);
    const res = await postFlip({ envelope, actor_user_id: ADMIN_USER });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("ORG_POLICY_MISSING");
  });
});
