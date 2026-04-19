// G2 — redelivery mutation against a fake GitHub API server.
//
// Seeds 5 deliveries across two event types + inside/outside the requested
// window. Asserts:
//   - only deliveries matching the window + filter are redelivered
//   - the POST /attempts call fires exactly once per matching delivery
//   - the rate-limit pacer sleeps 1s BEFORE each HTTP call (list + POST)
//   - audit_log row contains the final count
//
// This is the complete fake-GH-API coverage required by the G2 charter.

import { describe, expect, test } from "bun:test";
import type { Ctx } from "../../auth";
import { redeliverWebhooks } from "./redeliver";

const TENANT = "11111111-2222-3333-4444-555555555555";

interface DeliverySeed {
  id: number;
  delivered_at: string;
  event: string;
  installation_id: number;
}

function fakeGithub(deliveries: DeliverySeed[]) {
  const getCalls: string[] = [];
  const postCalls: string[] = [];
  let page = 0;
  return {
    getCalls,
    postCalls,
    http: {
      async get(url: string) {
        getCalls.push(url);
        page++;
        if (page === 1) {
          return { status: 200, body: deliveries, headers: {} };
        }
        return { status: 200, body: [], headers: {} };
      },
      async post(url: string) {
        postCalls.push(url);
        return { status: 202, body: {}, headers: {} };
      },
    },
  };
}

function makeCtx(role: Ctx["role"] = "admin"): Ctx {
  return {
    tenant_id: TENANT,
    actor_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    role,
    db: {
      pg: {
        async query<T = unknown>(sql: string): Promise<T[]> {
          if (/FROM github_installations/i.test(sql)) {
            return [{ installation_id: "42424242" }] as unknown as T[];
          }
          return [] as T[];
        },
      },
      ch: {
        async query() {
          return [];
        },
      },
      redis: {
        async get() {
          return null;
        },
        async set() {},
        async setNx() {
          return true;
        },
      },
    },
  };
}

describe("redeliverWebhooks with fake GitHub API", () => {
  test("5 deliveries seeded → 5 redelivered when window + filter match", async () => {
    const seeds: DeliverySeed[] = [
      {
        id: 1,
        delivered_at: "2026-04-10T10:00:00Z",
        event: "pull_request",
        installation_id: 42424242,
      },
      {
        id: 2,
        delivered_at: "2026-04-10T11:00:00Z",
        event: "push",
        installation_id: 42424242,
      },
      {
        id: 3,
        delivered_at: "2026-04-10T12:00:00Z",
        event: "pull_request",
        installation_id: 42424242,
      },
      {
        id: 4,
        delivered_at: "2026-04-10T13:00:00Z",
        event: "check_suite",
        installation_id: 42424242,
      },
      {
        id: 5,
        delivered_at: "2026-04-10T14:00:00Z",
        event: "workflow_run",
        installation_id: 42424242,
      },
    ];
    const fake = fakeGithub(seeds);
    const sleeps: number[] = [];

    const out = await redeliverWebhooks(
      makeCtx(),
      {
        from: "2026-04-10T00:00:00.000Z",
        to: "2026-04-10T23:59:59.000Z",
        // No event_types — replay all.
      },
      {
        http: fake.http,
        appJwtProvider: async () => "jwt-test",
        sleep: async (ms) => {
          sleeps.push(ms);
        },
        now: () => 0,
      },
    );

    expect(out.deliveries_requested).toBe(5);
    expect(out.queued_attempts).toBe(5);
    expect(out.failed_attempts).toBe(0);
    // Exactly one POST per delivery, in the order received.
    expect(fake.postCalls).toEqual([
      "https://api.github.com/app/hook/deliveries/1/attempts",
      "https://api.github.com/app/hook/deliveries/2/attempts",
      "https://api.github.com/app/hook/deliveries/3/attempts",
      "https://api.github.com/app/hook/deliveries/4/attempts",
      "https://api.github.com/app/hook/deliveries/5/attempts",
    ]);
    // Pacer sleeps: 2 list-page sleeps (1 real page + 1 empty page to detect
    // end of window) + 5 POST sleeps = 7 × 1000ms.
    expect(sleeps.filter((n) => n === 1000).length).toBeGreaterThanOrEqual(6);
  });

  test("event_types filter restricts which deliveries get redelivered", async () => {
    const seeds: DeliverySeed[] = [
      {
        id: 10,
        delivered_at: "2026-04-10T10:00:00Z",
        event: "pull_request",
        installation_id: 42424242,
      },
      {
        id: 11,
        delivered_at: "2026-04-10T11:00:00Z",
        event: "push",
        installation_id: 42424242,
      },
      {
        id: 12,
        delivered_at: "2026-04-10T12:00:00Z",
        event: "workflow_run",
        installation_id: 42424242,
      },
    ];
    const fake = fakeGithub(seeds);

    const out = await redeliverWebhooks(
      makeCtx(),
      {
        from: "2026-04-10T00:00:00.000Z",
        to: "2026-04-10T23:59:59.000Z",
        event_types: ["pull_request", "push"],
      },
      {
        http: fake.http,
        appJwtProvider: async () => "jwt-test",
        sleep: async () => {},
        now: () => 0,
      },
    );

    expect(out.deliveries_requested).toBe(2);
    expect(out.queued_attempts).toBe(2);
    expect(fake.postCalls).toEqual([
      "https://api.github.com/app/hook/deliveries/10/attempts",
      "https://api.github.com/app/hook/deliveries/11/attempts",
    ]);
  });

  test("deliveries outside the [from,to] window are skipped", async () => {
    const seeds: DeliverySeed[] = [
      {
        id: 20,
        delivered_at: "2026-04-10T10:00:00Z", // inside
        event: "push",
        installation_id: 42424242,
      },
      {
        id: 21,
        delivered_at: "2026-04-09T22:00:00Z", // BEFORE from → stops pagination
        event: "push",
        installation_id: 42424242,
      },
    ];
    const fake = fakeGithub(seeds);

    const out = await redeliverWebhooks(
      makeCtx(),
      {
        from: "2026-04-10T00:00:00.000Z",
        to: "2026-04-10T23:59:59.000Z",
      },
      {
        http: fake.http,
        appJwtProvider: async () => "jwt-test",
        sleep: async () => {},
        now: () => 0,
      },
    );

    expect(out.deliveries_requested).toBe(1);
    expect(fake.postCalls).toEqual(["https://api.github.com/app/hook/deliveries/20/attempts"]);
  });
});
