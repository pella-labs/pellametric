import { describe, expect, test } from "bun:test";
import type { GitEventRow } from "../webhooks/gitEventsStore";
import { reconcilePrs } from "./reconcile";

interface LoggedMsg {
  level: "info" | "warn" | "error";
  obj: Record<string, unknown>;
  msg: string;
}

function makeLogger(): { logger: import("./reconcile").Logger; messages: LoggedMsg[] } {
  const messages: LoggedMsg[] = [];
  return {
    messages,
    logger: {
      info: (obj, msg) => messages.push({ level: "info", obj, msg }),
      warn: (obj, msg) => messages.push({ level: "warn", obj, msg }),
      error: (obj, msg) => messages.push({ level: "error", obj, msg }),
    },
  };
}

function mkNode(i: number) {
  return {
    id: `PR_${i}`,
    number: i,
    merged: true,
    mergedAt: "2026-04-10T00:00:00Z",
    mergeCommit: { oid: `sha-${i}` },
    repository: { id: "R_A" },
  };
}

function page(
  nodes: ReturnType<typeof mkNode>[],
  hasNextPage: boolean,
  endCursor: string | null,
  remaining = 5000,
  issueCount?: number,
) {
  return {
    status: 200,
    body: {
      data: {
        search: {
          issueCount: issueCount ?? nodes.length,
          pageInfo: { hasNextPage, endCursor },
          nodes,
        },
        rateLimit: { remaining, resetAt: "2026-04-16T12:00:00Z" },
      },
    },
  };
}

function mockFetch(responses: Array<{ status: number; body: unknown }>): typeof fetch {
  let i = 0;
  const fn = (async () => {
    const idx = Math.min(i, responses.length - 1);
    const r = responses[idx];
    if (!r) throw new Error("mockFetch: no response configured");
    i++;
    return new Response(JSON.stringify(r.body), { status: r.status });
  }) as unknown as typeof fetch;
  return fn;
}

describe("reconcilePrs", () => {
  test("3 pages × 100/100/50 → 250 PRs upserted", async () => {
    const upserted: GitEventRow[] = [];
    const upsertRow = async (row: GitEventRow) => {
      upserted.push(row);
      return { inserted: true };
    };
    const p1 = Array.from({ length: 100 }, (_, i) => mkNode(i + 1));
    const p2 = Array.from({ length: 100 }, (_, i) => mkNode(i + 101));
    const p3 = Array.from({ length: 50 }, (_, i) => mkNode(i + 201));
    const fetchFn = mockFetch([
      page(p1, true, "cursor-1"),
      page(p2, true, "cursor-2"),
      page(p3, false, null),
    ]);
    const { logger, messages } = makeLogger();
    const out = await reconcilePrs({
      token: "t",
      org: "acme",
      sinceDate: "2026-04-09",
      fetchFn,
      upsertRow,
      logger,
    });
    expect(out.upserted).toBe(250);
    expect(upserted.length).toBe(250);
    expect(messages.find((m) => m.msg === "github-app graphql rate-limit low")).toBeUndefined();
  });

  test("1000-cap page → warning logged, day-partitioned query fires", async () => {
    const upserts: GitEventRow[] = [];
    const upsertRow = async (row: GitEventRow) => {
      upserts.push(row);
      return { inserted: true };
    };
    const capPage = page(
      Array.from({ length: 100 }, (_, i) => mkNode(i + 1)),
      true,
      null,
      5000,
      1200, // issueCount above 1000, endCursor null → cap detected
    );
    const dayPage = page(
      Array.from({ length: 10 }, (_, i) => mkNode(i + 500)),
      false,
      null,
    );
    const fetchFn = mockFetch([capPage, dayPage]);
    const { logger, messages } = makeLogger();
    const out = await reconcilePrs({
      token: "t",
      org: "acme",
      sinceDate: "2026-04-09",
      // M2 fix: pin today to sinceDate so the day-partition range is a single
      // day (1 fallback call → 10 upserts). Previously the fallback ran ONLY
      // a single-day query regardless; the fix iterates the full window, so
      // tests must pin `todayIso` to keep the mock fetch deterministic.
      todayIso: "2026-04-09",
      fetchFn,
      upsertRow,
      logger,
    });
    expect(out.upserted).toBe(110);
    expect(messages.some((m) => m.msg === "github-app graphql search hit 1000 cap")).toBe(true);
    expect(messages.some((m) => m.msg === "github-app: day-partitioning fallback")).toBe(true);
  });

  test("1000-cap page → day-partition iterates the FULL sinceDate..today window", async () => {
    // M2 regression: fallback must issue one query per day in [since..today],
    // not a single-day query for `sinceDate` only.
    const upserts: GitEventRow[] = [];
    const upsertRow = async (row: GitEventRow) => {
      upserts.push(row);
      return { inserted: true };
    };
    const capPage = page(
      Array.from({ length: 100 }, (_, i) => mkNode(i + 1)),
      true,
      null,
      5000,
      1200,
    );
    // 3-day window: expect 3 per-day paginate calls after the capped primary.
    const day1 = page([mkNode(501)], false, null);
    const day2 = page([mkNode(502)], false, null);
    const day3 = page([mkNode(503)], false, null);
    const fetchFn = mockFetch([capPage, day1, day2, day3]);
    const { logger } = makeLogger();
    const out = await reconcilePrs({
      token: "t",
      org: "acme",
      sinceDate: "2026-04-07",
      todayIso: "2026-04-09", // 3-day inclusive window: 04-07, 04-08, 04-09
      fetchFn,
      upsertRow,
      logger,
    });
    // 100 (primary) + 3 (one per day in fallback) = 103.
    expect(out.upserted).toBe(103);
  });

  test("rateLimit.remaining < 500 → warning logged", async () => {
    const upserts: GitEventRow[] = [];
    const upsertRow = async (row: GitEventRow) => {
      upserts.push(row);
      return { inserted: true };
    };
    const fetchFn = mockFetch([page([mkNode(1)], false, null, 100)]);
    const { logger, messages } = makeLogger();
    const out = await reconcilePrs({
      token: "t",
      org: "acme",
      sinceDate: "2026-04-09",
      fetchFn,
      upsertRow,
      logger,
    });
    expect(out.upserted).toBe(1);
    expect(out.rateLimitRemaining).toBe(100);
    expect(messages.some((m) => m.msg === "github-app graphql rate-limit low")).toBe(true);
  });
});
