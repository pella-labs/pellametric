// Tests for POST /v1/webhooks/github/:installation_id (PRD §7.1).
//
// Uses the ingest `handle()` entry so we exercise the full URL routing +
// flag gating + audit + bus-emission pipeline. No DB here — the in-memory
// doubles from deps.ts drive every path.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { InMemoryDedupStore } from "../dedup/checkDedup";
import { resetDeps, setDeps } from "../deps";
import { handle } from "../server";
import { InMemoryOrgPolicyStore } from "../tier/enforceTier";
import {
  createInMemoryInstallationResolver,
  type InstallationRecord,
} from "./installationResolver";
import { getCounterValue, resetGithubMetrics } from "./metrics";
import { createInMemoryWebhookSecretResolver } from "./secretsResolver";
import { createInMemoryWebhookBus, GITHUB_WEBHOOKS_TOPIC } from "./webhookBus";
import type { AuditLogSink } from "./webhookRoute";

const ACTIVE_SECRET = "active-secret-abc";
const PREV_SECRET = "prev-secret-xyz";
const TENANT_ID = "00000000-0000-0000-0000-000000000001";
const INSTALLATION_ID = 42424242n;

function sig(body: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

interface Ctx {
  resolver: ReturnType<typeof createInMemoryInstallationResolver>;
  secrets: ReturnType<typeof createInMemoryWebhookSecretResolver>;
  bus: ReturnType<typeof createInMemoryWebhookBus>;
  audit: { records: Array<{ action: string; metadata: Record<string, unknown> }> };
  auditSink: AuditLogSink;
  dedup: InMemoryDedupStore;
}

function baseInstallation(overrides: Partial<InstallationRecord> = {}): InstallationRecord {
  return {
    tenant_id: TENANT_ID,
    installation_id: INSTALLATION_ID,
    github_org_id: 123456n,
    github_org_login: "fixture-org",
    app_id: 909090n,
    status: "active",
    token_ref: "tok:t",
    webhook_secret_active_ref: "ws:active",
    webhook_secret_previous_ref: null,
    webhook_secret_rotated_at: null,
    ...overrides,
  };
}

function makeCtx(installOverrides: Partial<InstallationRecord> = {}): Ctx {
  const resolver = createInMemoryInstallationResolver();
  resolver.seed(baseInstallation(installOverrides));
  const secrets = createInMemoryWebhookSecretResolver({
    "ws:active": ACTIVE_SECRET,
    "ws:prev": PREV_SECRET,
  });
  const bus = createInMemoryWebhookBus();
  const records: Ctx["audit"]["records"] = [];
  const auditSink: AuditLogSink = async (row) => {
    records.push({ action: row.action, metadata: row.metadata });
  };
  const dedup = new InMemoryDedupStore();
  const policyStore = new InMemoryOrgPolicyStore();
  policyStore.seed(TENANT_ID, {
    tier_c_managed_cloud_optin: false,
    tier_default: "B",
  });
  setDeps({
    installationResolver: resolver,
    webhookSecretsResolver: secrets,
    githubWebhookBus: bus,
    githubAuditSink: auditSink,
    webhookDedup: dedup,
    orgPolicyStore: policyStore,
    flags: {
      ENFORCE_TIER_A_ALLOWLIST: false,
      WAL_APPEND_ENABLED: false,
      WAL_CONSUMER_ENABLED: false,
      OTLP_RECEIVER_ENABLED: false,
      WEBHOOKS_ENABLED: true,
      CLICKHOUSE_WRITER: "client",
    },
  });
  return { resolver, secrets, bus, audit: { records }, auditSink, dedup };
}

async function postPath(
  installationId: string,
  body: string,
  opts: {
    deliveryId?: string;
    event?: string;
    signature?: string;
  } = {},
): Promise<Response> {
  const url = `http://localhost/v1/webhooks/github/${installationId}`;
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-github-event": opts.event ?? "pull_request",
    "x-github-delivery": opts.deliveryId ?? "d-x",
  };
  if (opts.signature !== undefined) {
    headers["x-hub-signature-256"] = opts.signature;
  }
  return handle(new Request(url, { method: "POST", headers, body }));
}

beforeEach(() => {
  resetDeps();
  resetGithubMetrics();
});
afterEach(() => {
  resetDeps();
  resetGithubMetrics();
});

describe("POST /v1/webhooks/github/:installation_id — path-param route", () => {
  test("unknown installation_id → 404 UNKNOWN_INSTALLATION", async () => {
    makeCtx();
    const body = '{"action":"opened"}';
    const res = await postPath("999", body, { signature: sig(body, ACTIVE_SECRET) });
    expect(res.status).toBe(404);
    const j = (await res.json()) as { code: string };
    expect(j.code).toBe("UNKNOWN_INSTALLATION");
  });

  test("revoked installation_id → 404 INSTALLATION_REVOKED", async () => {
    makeCtx({ status: "revoked" });
    const body = '{"action":"opened"}';
    const res = await postPath(INSTALLATION_ID.toString(), body, {
      signature: sig(body, ACTIVE_SECRET),
    });
    expect(res.status).toBe(404);
    const j = (await res.json()) as { code: string };
    expect(j.code).toBe("INSTALLATION_REVOKED");
  });

  test("H6 — suspended installation_id → 404 INSTALLATION_SUSPENDED + audit", async () => {
    const ctx = makeCtx({ status: "suspended" });
    const body = '{"action":"opened"}';
    const res = await postPath(INSTALLATION_ID.toString(), body, {
      signature: sig(body, ACTIVE_SECRET),
      deliveryId: "d-sus-1",
    });
    expect(res.status).toBe(404);
    const j = (await res.json()) as { code: string };
    expect(j.code).toBe("INSTALLATION_SUSPENDED");
    // Must NOT have published to the bus
    expect(ctx.bus.peek(GITHUB_WEBHOOKS_TOPIC).length).toBe(0);
    // Must audit the rejection
    const audits = ctx.audit.records.filter(
      (r) => r.action === "github.webhook.installation_not_active",
    );
    expect(audits.length).toBe(1);
    expect(audits[0]?.metadata.status).toBe("suspended");
  });

  test("H6 — reconnecting installation_id → 404 INSTALLATION_RECONNECTING + audit", async () => {
    const ctx = makeCtx({ status: "reconnecting" });
    const body = '{"action":"opened"}';
    const res = await postPath(INSTALLATION_ID.toString(), body, {
      signature: sig(body, ACTIVE_SECRET),
      deliveryId: "d-rec-1",
    });
    expect(res.status).toBe(404);
    const j = (await res.json()) as { code: string };
    expect(j.code).toBe("INSTALLATION_RECONNECTING");
    expect(ctx.bus.peek(GITHUB_WEBHOOKS_TOPIC).length).toBe(0);
    const audits = ctx.audit.records.filter(
      (r) => r.action === "github.webhook.installation_not_active",
    );
    expect(audits.length).toBe(1);
    expect(audits[0]?.metadata.status).toBe("reconnecting");
  });

  test("H6 — revoked installation also writes audit (strict allowlist)", async () => {
    const ctx = makeCtx({ status: "revoked" });
    const body = '{"action":"opened"}';
    await postPath(INSTALLATION_ID.toString(), body, {
      signature: sig(body, ACTIVE_SECRET),
      deliveryId: "d-rev-1",
    });
    const audits = ctx.audit.records.filter(
      (r) => r.action === "github.webhook.installation_not_active",
    );
    expect(audits.length).toBe(1);
    expect(audits[0]?.metadata.status).toBe("revoked");
  });

  test("active + valid signature → 200 accepted:true + bus emission", async () => {
    const ctx = makeCtx();
    const body = '{"action":"opened","pull_request":{"node_id":"PR_1","number":1}}';
    const res = await postPath(INSTALLATION_ID.toString(), body, {
      signature: sig(body, ACTIVE_SECRET),
      deliveryId: "d-ok-1",
    });
    expect(res.status).toBe(200);
    const j = (await res.json()) as { accepted?: boolean; path?: string };
    expect(j.accepted).toBe(true);
    expect(j.path).toBe("active");
    const msgs = ctx.bus.peek(GITHUB_WEBHOOKS_TOPIC);
    expect(msgs.length).toBe(1);
    expect(msgs[0]?.key).toBe(`${TENANT_ID}:${INSTALLATION_ID}`);
  });

  test("tampered body (wrong HMAC) → 401 BAD_SIGNATURE + audit_log row + reject metric", async () => {
    const ctx = makeCtx();
    const body = '{"action":"opened"}';
    const res = await postPath(INSTALLATION_ID.toString(), body, {
      signature: `sha256=${"0".repeat(64)}`,
      deliveryId: "d-bad-1",
    });
    expect(res.status).toBe(401);
    const j = (await res.json()) as { code: string; reason: string };
    expect(j.code).toBe("BAD_SIGNATURE");
    expect(ctx.audit.records.length).toBe(1);
    const entry = ctx.audit.records[0];
    expect(entry?.action).toBe("github.webhook.signature_reject");
    expect(entry?.metadata.delivery_id).toBe("d-bad-1");
    // Reject metric (reason=both_mismatch since no previous is set).
    expect(
      getCounterValue("github_webhook_signature_reject_total", {
        reason: "active_mismatch_no_previous_ref",
      }),
    ).toBe(1);
  });

  test("dedup: same X-GitHub-Delivery twice → 2nd 200 dedup:true, bus not re-published", async () => {
    const ctx = makeCtx();
    const body = '{"action":"opened"}';
    const signed = sig(body, ACTIVE_SECRET);
    const r1 = await postPath(INSTALLATION_ID.toString(), body, {
      signature: signed,
      deliveryId: "d-same",
    });
    expect(r1.status).toBe(200);
    const r2 = await postPath(INSTALLATION_ID.toString(), body, {
      signature: signed,
      deliveryId: "d-same",
    });
    expect(r2.status).toBe(200);
    const j2 = (await r2.json()) as { dedup?: boolean };
    expect(j2.dedup).toBe(true);
    const msgs = ctx.bus.peek(GITHUB_WEBHOOKS_TOPIC);
    expect(msgs.length).toBe(1);
  });

  test("WEBHOOKS_ENABLED=false → 503", async () => {
    const ctx = makeCtx();
    setDeps({
      flags: {
        ENFORCE_TIER_A_ALLOWLIST: false,
        WAL_APPEND_ENABLED: false,
        WAL_CONSUMER_ENABLED: false,
        OTLP_RECEIVER_ENABLED: false,
        WEBHOOKS_ENABLED: false,
        CLICKHOUSE_WRITER: "client",
      },
    });
    const body = '{"action":"opened"}';
    const res = await postPath(INSTALLATION_ID.toString(), body, {
      signature: sig(body, ACTIVE_SECRET),
    });
    expect(res.status).toBe(503);
    // ctx unused below — suppress lint
    void ctx;
  });

  test("non-numeric installation_id in path → 400 BAD_INSTALLATION_ID", async () => {
    makeCtx();
    const body = "{}";
    const res = await postPath("not-a-bigint", body);
    expect(res.status).toBe(400);
    const j = (await res.json()) as { code: string };
    expect(j.code).toBe("BAD_INSTALLATION_ID");
  });
});

describe("webhook secret rotation (D55) — 4-phase scenario", () => {
  test("rotate + dual-accept + eviction lifecycle", async () => {
    const ctx = makeCtx();
    // Phase 1 — before rotation: new-secret sig rejects; old-secret accepts.
    {
      const body = '{"phase":"before-rotation"}';
      const okRes = await postPath(INSTALLATION_ID.toString(), body, {
        signature: sig(body, ACTIVE_SECRET),
        deliveryId: "d-pre-1",
      });
      expect(okRes.status).toBe(200);
    }
    // Phase 2 — rotate: active=NEW, previous=OLD(=former active), rotated_at=now.
    const NEW_SECRET = "new-secret-after-rotation";
    ctx.secrets.seed("ws:new", NEW_SECRET);
    // PREV_SECRET was already seeded as "ws:prev" — we use a dedicated ref so
    // the rotation test exercises the resolver layer cleanly. To simulate the
    // typical flow where "previous" holds the FORMER active secret, seed it.
    ctx.secrets.seed("ws:was-active", ACTIVE_SECRET);
    const rotatedAt = new Date("2026-04-18T00:00:00Z");
    ctx.resolver.rotate(INSTALLATION_ID, {
      active_ref: "ws:new",
      previous_ref: "ws:was-active",
      rotated_at: rotatedAt,
    });

    // Phase 3 — inside window: OLD signs → 200 via fallback path; NEW signs → 200 active.
    // Inject clock via deps — handle() doesn't take a clock, but
    // verifyWithRotation reads clock from its deps. We stub by overriding
    // setDeps with a custom githubAuditSink that also flips the resolver's
    // clock — actually the deps path in webhookRoute uses `deps.clock`
    // internally. We set that via setDeps patch.
    // Because setDeps's Deps doesn't expose a clock, we compensate by
    // rotating with rotated_at very recent (now() - 5s) instead.
    ctx.resolver.rotate(INSTALLATION_ID, {
      active_ref: "ws:new",
      previous_ref: "ws:was-active",
      rotated_at: new Date(Date.now() - 5 * 1000), // 5s ago (well inside 10 min)
    });
    {
      const body = '{"phase":"during-rotation-old-secret"}';
      const res = await postPath(INSTALLATION_ID.toString(), body, {
        signature: sig(body, ACTIVE_SECRET),
        deliveryId: "d-mid-old",
      });
      expect(res.status).toBe(200);
      const j = (await res.json()) as { path?: string };
      expect(j.path).toBe("fallback");
      expect(getCounterValue("github_webhook_signature_fallback_used_total")).toBe(1);
    }
    {
      const body = '{"phase":"during-rotation-new-secret"}';
      const res = await postPath(INSTALLATION_ID.toString(), body, {
        signature: sig(body, NEW_SECRET),
        deliveryId: "d-mid-new",
      });
      expect(res.status).toBe(200);
      const j = (await res.json()) as { path?: string };
      expect(j.path).toBe("active");
    }

    // Phase 4 — eviction cron runs: rotated_at cleared, previous_ref nulled.
    // OLD signature must now reject.
    ctx.resolver.rotate(INSTALLATION_ID, {
      active_ref: "ws:new",
      previous_ref: null,
      rotated_at: null,
    });
    {
      const body = '{"phase":"post-eviction"}';
      const res = await postPath(INSTALLATION_ID.toString(), body, {
        signature: sig(body, ACTIVE_SECRET),
        deliveryId: "d-post-old",
      });
      expect(res.status).toBe(401);
      const j = (await res.json()) as { code: string; reason: string };
      expect(j.code).toBe("BAD_SIGNATURE");
      expect(j.reason).toBe("active_mismatch_no_previous_ref");
    }
  });
});
