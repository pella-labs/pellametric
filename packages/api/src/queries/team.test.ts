import { describe, expect, test } from "bun:test";
import type { Ctx } from "../auth";
import { getTwoByTwo, listTeams } from "./team";

describe("listTeams", () => {
  test("returns teams with engineer counts and gated scores", async () => {
    const out = await listTeams(makeCtx(), { window: "30d" });
    expect(out.window).toBe("30d");
    expect(out.teams.length).toBeGreaterThan(0);
    for (const t of out.teams) {
      expect(t.engineers).toBeGreaterThan(0);
      expect(t.cost_usd).toBeGreaterThanOrEqual(0);
      expect(typeof t.ai_leverage_score.show).toBe("boolean");
    }
  });
});

describe("getTwoByTwo", () => {
  test("team with >=5 engineers passes the k-anonymity floor and emits points", async () => {
    const out = await getTwoByTwo(makeCtx(), {
      window: "30d",
      team_id: "team_growth", // 12 engineers in fixture
    });
    expect(out.display.show).toBe(true);
    expect(out.cohort_size).toBe(12);
    expect(out.points.length).toBe(12);
    for (const p of out.points) {
      expect(p.engineer_id_hash.length).toBe(8);
      expect(p.outcome_quality).toBeGreaterThanOrEqual(0);
      expect(p.outcome_quality).toBeLessThanOrEqual(100);
      expect(p.efficiency).toBeGreaterThanOrEqual(0);
      expect(p.efficiency).toBeLessThanOrEqual(100);
    }
  });

  test("team with <5 engineers trips k_anonymity_floor, scatter suppressed", async () => {
    const out = await getTwoByTwo(makeCtx(), {
      window: "30d",
      team_id: "team_ml", // 4 engineers in fixture
    });
    expect(out.display.show).toBe(false);
    if (out.display.show === false) {
      expect(out.display.suppression_reason).toBe("k_anonymity_floor");
    }
    expect(out.points.length).toBe(0);
  });

  test("unknown team_id → cohort_size 0 and k_anonymity_floor suppression", async () => {
    const out = await getTwoByTwo(makeCtx(), {
      window: "7d",
      team_id: "team_ghost",
    });
    expect(out.cohort_size).toBe(0);
    expect(out.display.show).toBe(false);
  });

  test("viewer role is rejected (2×2 is manager-only)", async () => {
    const viewerCtx = { ...makeCtx(), role: "viewer" as const };
    await expect(
      getTwoByTwo(viewerCtx, { window: "30d", team_id: "team_growth" }),
    ).rejects.toThrow();
  });
});

function makeCtx(): Ctx {
  return {
    tenant_id: "test-tenant",
    actor_id: "test-actor",
    role: "manager",
    db: {
      pg: { query: async () => [] },
      ch: { query: async () => [] },
      redis: {
        get: async () => null,
        set: async () => undefined,
        setNx: async () => true,
      },
    },
  };
}
