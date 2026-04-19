import { beforeAll, describe, expect, test } from "bun:test";
import type { Ctx } from "../../auth";

beforeAll(() => {
  // .env at the repo root pins USE_FIXTURES=0 for local dev reads; force
  // the fixture branch here so these unit tests don't require a live CH/PG.
  process.env.USE_FIXTURES = "1";
});
import {
  ActivityOverviewOutput,
  CodeDeliveryOutput,
  CohortFiltersOutput,
  SessionDetailOutput,
  SessionsFeedOutput,
} from "../../schemas/new-dashboard";
import {
  activityOverview,
  codeDelivery,
  cohortFilters,
  sessionDetail,
  sessionsFeed,
} from "./index";

const noopCh = {
  query: async () => [],
};
const noopPg = {
  query: async () => [],
};
const noopRedis = {
  get: async () => null,
  set: async () => {},
  setNx: async () => true,
};

function buildCtx(): Ctx {
  return {
    tenant_id: "org-fx",
    actor_id: "actor-fx",
    role: "manager",
    db: { ch: noopCh as never, pg: noopPg as never, redis: noopRedis as never },
  };
}

// NB: these tests run with the default fixture branch (USE_FIXTURES unset → true).

describe("activityOverview fixture", () => {
  test("returns schema-valid output with 30d=30 daily points", async () => {
    const ctx = buildCtx();
    const out = await activityOverview(ctx, { window: "30d" });
    expect(ActivityOverviewOutput.safeParse(out).success).toBe(true);
    expect(out.daily.length).toBe(30);
    expect(out.heatmap.length).toBe(7 * 24);
  });

  test("7d window produces 7 daily points", async () => {
    const out = await activityOverview(buildCtx(), { window: "7d" });
    expect(out.daily.length).toBe(7);
  });
});

describe("codeDelivery fixture", () => {
  test("returns schema-valid output", async () => {
    const out = await codeDelivery(buildCtx(), { window: "30d" });
    expect(CodeDeliveryOutput.safeParse(out).success).toBe(true);
    expect(out.recent_prs.length).toBe(25);
    expect(out.pr_by_repo.length).toBeGreaterThan(0);
  });

  test("cost_per_merged_pr is a real number in fixtures", async () => {
    const out = await codeDelivery(buildCtx(), { window: "30d" });
    expect(typeof out.cost_per_merged_pr).toBe("number");
  });
});

describe("sessionsFeed fixture", () => {
  test("returns page_size rows with valid schema", async () => {
    const out = await sessionsFeed(buildCtx(), { window: "30d", page_size: 25 });
    expect(SessionsFeedOutput.safeParse(out).success).toBe(true);
    expect(out.rows.length).toBe(25);
  });

  test("rows never carry prompt_text / tool_input / tool_output (Tier B)", async () => {
    const out = await sessionsFeed(buildCtx(), { window: "30d", page_size: 10 });
    for (const r of out.rows) {
      expect((r as Record<string, unknown>).prompt_text).toBeUndefined();
      expect((r as Record<string, unknown>).tool_input).toBeUndefined();
      expect((r as Record<string, unknown>).tool_output).toBeUndefined();
    }
  });
});

describe("sessionDetail fixture", () => {
  test("returns schema-valid detail payload", async () => {
    const out = await sessionDetail(buildCtx(), { session_id: "sess-fx-1" });
    expect(SessionDetailOutput.safeParse(out).success).toBe(true);
    expect(out.timeline.length).toBeGreaterThan(0);
    expect(out.tool_breakdown.length).toBeGreaterThan(0);
  });
});

describe("cohortFilters fixture", () => {
  test("returns schema-valid cohort payload", async () => {
    const out = await cohortFilters(buildCtx());
    expect(CohortFiltersOutput.safeParse(out).success).toBe(true);
  });
});
