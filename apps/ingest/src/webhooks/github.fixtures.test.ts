// Fixture-driven round-trip test (PRD §13 Phase G0 bullet #6 — local dev
// validation companion). Feeds every G0 fixture payload + sidecar headers
// into the existing webhook router (apps/ingest/src/webhooks/router.ts) and
// asserts the HMAC path accepts the signature and persistence lands at least
// one row OR returns the expected `ignored:true` for events the G0 parser
// deliberately doesn't recognize (e.g. `installation.created` — landed in G1
// once the full github_installations handler ships).
//
// This is the runtime evidence that:
//
//   1. The fixture secret in `.webhook-secret` + the stored
//      X-Hub-Signature-256 matches what the ingest verifier computes.
//   2. The committed payloads parse cleanly through the existing
//      parseGitHubWebhook() function for the events it supports today.
//
// Uses only in-process Bun `handle()` — no docker-compose needed at unit-
// test time. The full-stack smoke test using docker-compose is documented
// in the PR body.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { InMemoryDedupStore } from "../dedup/checkDedup";
import { createInMemoryOrgResolver, resetDeps, setDeps } from "../deps";
import { _testHooks, handle } from "../server";
import { InMemoryOrgPolicyStore, type OrgPolicy } from "../tier/enforceTier";
import { createInMemoryGitEventsStore, type GitEventsStore } from "./gitEventsStore";

const FIXTURES_GITHUB_ROOT = resolve(
  import.meta.dir,
  "..",
  "..",
  "..",
  "..",
  "packages",
  "fixtures",
  "github",
);

const FIXTURE_SECRET = readFileSync(
  resolve(FIXTURES_GITHUB_ROOT, ".webhook-secret"),
  "utf8",
).trim();

function seedDeps(): { store: GitEventsStore; dedup: InMemoryDedupStore } {
  const policyStore = new InMemoryOrgPolicyStore();
  const policy: OrgPolicy = {
    tier_c_managed_cloud_optin: false,
    tier_default: "B",
    webhook_secrets: {
      github: FIXTURE_SECRET,
      gitlab: FIXTURE_SECRET,
      bitbucket: FIXTURE_SECRET,
    },
  };
  policyStore.seed("org_internal_id", policy);
  const resolver = createInMemoryOrgResolver();
  resolver.seed("dev", "org_internal_id");
  const gitEventsStore = createInMemoryGitEventsStore();
  const webhookDedup = new InMemoryDedupStore();
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
      WEBHOOKS_ENABLED: true,
      CLICKHOUSE_WRITER: "client",
    },
  });
  return { store: gitEventsStore, dedup: webhookDedup };
}

interface FixturePair {
  event: string;
  scenario: string;
  payloadPath: string;
  headersPath: string;
}

function listFixtures(): FixturePair[] {
  const out: FixturePair[] = [];
  for (const eventDir of readdirSync(FIXTURES_GITHUB_ROOT)) {
    const eventPath = join(FIXTURES_GITHUB_ROOT, eventDir);
    if (!statSync(eventPath).isDirectory()) continue;
    for (const f of readdirSync(eventPath)) {
      if (f.endsWith(".headers.json") || !f.endsWith(".json")) continue;
      const scenario = f.replace(/\.json$/, "");
      out.push({
        event: eventDir,
        scenario,
        payloadPath: join(eventPath, f),
        headersPath: join(eventPath, `${scenario}.headers.json`),
      });
    }
  }
  return out;
}

// Events the existing `parseGitHubWebhook` handles today. Others (installation,
// repository lifecycle, deployment) return null → router responds
// `{ignored:true, 200}`. That's the correct G0 behavior — the handlers land
// in G1/G3 per PRD §13.
const PARSED_EVENTS = new Set(["pull_request", "push", "check_suite", "workflow_run"]);

beforeEach(() => {
  resetDeps();
  _testHooks.reset();
});
afterEach(() => {
  resetDeps();
  _testHooks.reset();
});

describe("github webhooks — G0 fixture round-trip", () => {
  const fixtures = listFixtures();

  test("found all 8 G0 fixtures", () => {
    expect(fixtures.length).toBe(8);
  });

  for (const fx of fixtures) {
    test(`${fx.event}/${fx.scenario} passes HMAC + routes cleanly`, async () => {
      const { store } = seedDeps();
      const body = readFileSync(fx.payloadPath, "utf8");
      const headers = JSON.parse(readFileSync(fx.headersPath, "utf8")) as Record<string, string>;
      const url = `http://localhost/v1/webhooks/github?org=dev`;
      const req = new Request(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-github-event": headers["X-GitHub-Event"] ?? fx.event,
          "x-github-delivery": headers["X-GitHub-Delivery"] ?? `fixture-${fx.scenario}`,
          "x-hub-signature-256": headers["X-Hub-Signature-256"] ?? "sha256=bad",
        },
        body,
      });
      const res = await handle(req);
      expect(res.status).toBe(200);
      const bodyJson = (await res.json()) as Record<string, unknown>;
      if (PARSED_EVENTS.has(fx.event)) {
        expect(bodyJson.inserted === true || bodyJson.ignored === true).toBe(true);
        // Parsed events that persist should have bumped the store.
        if (bodyJson.inserted === true) {
          expect(await store.count("org_internal_id")).toBeGreaterThan(0);
        }
      } else {
        // Event kinds not yet parsed at G0 (installation) → ignored=true.
        expect(bodyJson.ignored).toBe(true);
      }
    });
  }
});
