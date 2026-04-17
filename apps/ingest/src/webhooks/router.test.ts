import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { InMemoryDedupStore } from "../dedup/checkDedup";
import { createInMemoryOrgResolver, resetDeps, setDeps } from "../deps";
import { _testHooks, handle } from "../server";
import { InMemoryOrgPolicyStore, type OrgPolicy } from "../tier/enforceTier";
import { createInMemoryGitEventsStore, type GitEventsStore } from "./gitEventsStore";

const SECRET = "hooksecret";

function seedDeps(
  overrides: {
    webhooksEnabled?: boolean;
    webhookSecrets?: OrgPolicy["webhook_secrets"];
    ipAllowlist?: string[];
    gitEventsStore?: GitEventsStore;
    webhookDedup?: InMemoryDedupStore;
  } = {},
): {
  store: GitEventsStore;
  dedup: InMemoryDedupStore;
} {
  const policyStore = new InMemoryOrgPolicyStore();
  const policy: OrgPolicy = {
    tier_c_managed_cloud_optin: false,
    tier_default: "B",
    webhook_secrets: overrides.webhookSecrets ?? {
      github: SECRET,
      gitlab: SECRET,
      bitbucket: SECRET,
    },
    ...(overrides.ipAllowlist ? { webhook_source_ip_allowlist: overrides.ipAllowlist } : {}),
  };
  policyStore.seed("org_internal_id", policy);
  const resolver = createInMemoryOrgResolver();
  resolver.seed("dev", "org_internal_id");
  const gitEventsStore = overrides.gitEventsStore ?? createInMemoryGitEventsStore();
  const webhookDedup = overrides.webhookDedup ?? new InMemoryDedupStore();
  setDeps({
    orgPolicyStore: policyStore,
    orgResolver: resolver,
    gitEventsStore,
    webhookDedup,
    flags: {
      ENFORCE_TIER_A_ALLOWLIST: false,
      WAL_APPEND_ENABLED: false,
      WAL_CONSUMER_ENABLED: false,
      OTLP_RECEIVER_ENABLED: false,
      WEBHOOKS_ENABLED: overrides.webhooksEnabled ?? true,
      CLICKHOUSE_WRITER: "client",
    },
  });
  return { store: gitEventsStore, dedup: webhookDedup };
}

function sigHex(body: string, secret = SECRET): string {
  return createHmac("sha256", Buffer.from(secret, "utf8")).update(body).digest("hex");
}

async function postGithub(
  body: string,
  opts: {
    org?: string;
    deliveryId?: string;
    event?: string;
    signature?: string;
  } = {},
): Promise<Response> {
  const url = `http://localhost/v1/webhooks/github?org=${opts.org ?? "dev"}`;
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-github-event": opts.event ?? "pull_request",
    "x-github-delivery": opts.deliveryId ?? "del-1",
  };
  if (opts.signature !== undefined) {
    headers["x-hub-signature-256"] = opts.signature;
  } else {
    headers["x-hub-signature-256"] = `sha256=${sigHex(body)}`;
  }
  return handle(new Request(url, { method: "POST", headers, body }));
}

beforeEach(() => {
  resetDeps();
  _testHooks.reset();
});
afterEach(() => {
  resetDeps();
  _testHooks.reset();
});

describe("webhooks router — /v1/webhooks/github", () => {
  test("valid pull_request.closed → 200 inserted=true, row in store", async () => {
    const { store } = seedDeps();
    const body = JSON.stringify({
      action: "closed",
      pull_request: {
        node_id: "PR_ABC",
        number: 7,
        merge_commit_sha: "sha-xyz",
        merged_at: "2026-04-16T12:00:00Z",
      },
      repository: { node_id: "R_1" },
    });
    const res = await postGithub(body, { deliveryId: "d1" });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { inserted: boolean; pr_node_id: string };
    expect(json.inserted).toBe(true);
    expect(json.pr_node_id).toBe("PR_ABC");
    expect(await store.count("org_internal_id")).toBe(1);
  });

  test("wrong HMAC → 401", async () => {
    seedDeps();
    const body = JSON.stringify({
      action: "opened",
      pull_request: { node_id: "PR_A", number: 1 },
      repository: { node_id: "R_1" },
    });
    const res = await postGithub(body, {
      signature: `sha256=${"0".repeat(64)}`,
    });
    expect(res.status).toBe(401);
  });

  test("transport dedup: same X-GitHub-Delivery twice → second 200 dedup:true, count unchanged", async () => {
    const { store } = seedDeps();
    const body = JSON.stringify({
      action: "opened",
      pull_request: { node_id: "PR_D", number: 1 },
      repository: { node_id: "R_1" },
    });
    const r1 = await postGithub(body, { deliveryId: "same-delivery" });
    expect(r1.status).toBe(200);
    const r2 = await postGithub(body, { deliveryId: "same-delivery" });
    expect(r2.status).toBe(200);
    const j = (await r2.json()) as { dedup?: boolean };
    expect(j.dedup).toBe(true);
    expect(await store.count("org_internal_id")).toBe(1);
  });

  test("row-level collision: same pr_node_id twice (different delivery IDs) → second inserted:false", async () => {
    const { store } = seedDeps();
    const body = JSON.stringify({
      action: "opened",
      pull_request: { node_id: "PR_SAME", number: 1 },
      repository: { node_id: "R_1" },
    });
    const r1 = await postGithub(body, { deliveryId: "d-1" });
    expect(((await r1.json()) as { inserted: boolean }).inserted).toBe(true);
    const r2 = await postGithub(body, { deliveryId: "d-2" });
    expect(((await r2.json()) as { inserted: boolean }).inserted).toBe(false);
    expect(await store.count("org_internal_id")).toBe(1);
  });

  test("enforceTier is NEVER called on webhook path (D-S1-32)", async () => {
    seedDeps();
    _testHooks.reset();
    const body = JSON.stringify({
      action: "opened",
      pull_request: { node_id: "PR_TIER", number: 1 },
      repository: { node_id: "R_1" },
    });
    await postGithub(body, { deliveryId: "d-tier" });
    expect(_testHooks.enforceTierCallCount).toBe(0);
  });

  test("unknown event type → 200 ignored:true", async () => {
    seedDeps();
    const body = JSON.stringify({ zen: "hi", repository: { node_id: "R_1" } });
    const res = await postGithub(body, { deliveryId: "d-ping", event: "ping" });
    expect(res.status).toBe(200);
    const j = (await res.json()) as { ignored?: boolean };
    expect(j.ignored).toBe(true);
  });

  test("WEBHOOKS_ENABLED=false → 503", async () => {
    seedDeps({ webhooksEnabled: false });
    const body = JSON.stringify({
      action: "opened",
      pull_request: { node_id: "PR_X", number: 1 },
      repository: { node_id: "R_1" },
    });
    const res = await postGithub(body);
    expect(res.status).toBe(503);
    const j = (await res.json()) as { code: string };
    expect(j.code).toBe("WEBHOOKS_DISABLED");
  });

  test("missing ?org query param → 400 MISSING_ORG", async () => {
    seedDeps();
    const body = "{}";
    const sig = `sha256=${sigHex(body)}`;
    const res = await handle(
      new Request("http://localhost/v1/webhooks/github", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-github-event": "pull_request",
          "x-github-delivery": "d-x",
          "x-hub-signature-256": sig,
        },
        body,
      }),
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe("MISSING_ORG");
  });

  test("raw-body preservation: whitespace-reformatted body fails HMAC", async () => {
    seedDeps();
    const original =
      '{  "action":"opened","pull_request":{"node_id":"PR_WS","number":2},"repository":{"node_id":"R_1"}  }';
    const sig = `sha256=${sigHex(original)}`;
    // Client "helpfully" reformats before sending; HMAC now mismatches.
    const reformatted = JSON.stringify(JSON.parse(original));
    const res = await handle(
      new Request("http://localhost/v1/webhooks/github?org=dev", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-github-event": "pull_request",
          "x-github-delivery": "d-ws",
          "x-hub-signature-256": sig,
        },
        body: reformatted,
      }),
    );
    expect(res.status).toBe(401);
  });

  test("M1: XFF chain — leftmost entry becomes sourceIp", async () => {
    // Seed an IP allowlist that matches the leftmost IP in a chain. The raw
    // header "1.2.3.4, 10.0.0.1" must parse to "1.2.3.4" (client), not fail
    // to match as a strict-equal string.
    seedDeps({ ipAllowlist: ["1.2.3.4"] });
    const body = JSON.stringify({ project: { id: 7 }, object_kind: "push" });
    const res = await handle(
      new Request("http://localhost/v1/webhooks/gitlab?org=dev", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-gitlab-event": "Push Hook",
          "x-gitlab-event-uuid": "d-xff",
          "x-gitlab-token": SECRET,
          "x-forwarded-for": "1.2.3.4, 10.0.0.1",
        },
        body,
      }),
    );
    expect(res.status).toBe(200);
  });

  test("M1: XFF with a non-allowlisted leftmost entry → 401", async () => {
    seedDeps({ ipAllowlist: ["1.2.3.4"] });
    const body = JSON.stringify({ project: { id: 7 }, object_kind: "push" });
    const res = await handle(
      new Request("http://localhost/v1/webhooks/gitlab?org=dev", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-gitlab-event": "Push Hook",
          "x-gitlab-event-uuid": "d-xff2",
          "x-gitlab-token": SECRET,
          "x-forwarded-for": "9.9.9.9, 1.2.3.4",
        },
        body,
      }),
    );
    expect(res.status).toBe(401);
  });
});
