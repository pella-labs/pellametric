import { describe, expect, test } from "bun:test";
import type { Ctx } from "../auth";
import { perCommitOutcomes, perDevOutcomes, perPROutcomes } from "./outcomes";

describe("perDevOutcomes", () => {
  test("returns rows with 8-char engineer hash + sorted by cost desc", async () => {
    const out = await perDevOutcomes(makeCtx("manager"), {
      window: "30d",
      team_id: "team_growth",
      limit: 200,
    });
    expect(out.rows.length).toBeGreaterThan(0);
    expect(out.cohort_size).toBeGreaterThanOrEqual(out.rows.length);
    for (const row of out.rows) {
      expect(row.engineer_id_hash.length).toBe(8);
      expect(row.cost_usd).toBeGreaterThanOrEqual(0);
      expect(row.accepted_and_retained).toBeLessThanOrEqual(row.accepted_edits);
    }
    for (let i = 1; i < out.rows.length; i++) {
      expect(out.rows[i - 1]!.cost_usd).toBeGreaterThanOrEqual(out.rows[i]!.cost_usd);
    }
  });

  test("engineer role is rejected (per-dev team aggregate is manager-only)", async () => {
    await expect(
      perDevOutcomes(makeCtx("engineer"), { window: "30d", limit: 200 }),
    ).rejects.toThrow();
  });
});

describe("perPROutcomes", () => {
  test("aggregates totals match the row-wise sums", async () => {
    const out = await perPROutcomes(makeCtx("manager"), {
      window: "30d",
      repo: "acme/backend",
      limit: 200,
    });
    const summed = out.rows.reduce(
      (acc, r) => {
        acc.prs += 1;
        acc.cost_usd += r.cost_usd;
        if (r.reverted) acc.reverted_prs += 1;
        if (r.ai_assisted) acc.ai_assisted_prs += 1;
        return acc;
      },
      { prs: 0, cost_usd: 0, reverted_prs: 0, ai_assisted_prs: 0 },
    );
    expect(out.totals.prs).toBe(summed.prs);
    expect(out.totals.reverted_prs).toBe(summed.reverted_prs);
    expect(out.totals.ai_assisted_prs).toBe(summed.ai_assisted_prs);
    expect(Math.abs(out.totals.cost_usd - summed.cost_usd)).toBeLessThan(0.05);
  });

  test("non-AI-assisted PRs always report zero attributed cost", async () => {
    const out = await perPROutcomes(makeCtx("viewer"), {
      window: "30d",
      limit: 200,
    });
    for (const r of out.rows) {
      if (!r.ai_assisted) expect(r.cost_usd).toBe(0);
    }
  });
});

describe("perCommitOutcomes", () => {
  test("returns deterministic commits with 40-char shas", async () => {
    const a = await perCommitOutcomes(makeCtx("manager"), {
      window: "7d",
      limit: 50,
    });
    const b = await perCommitOutcomes(makeCtx("manager"), {
      window: "7d",
      limit: 50,
    });
    expect(a.rows.map((r) => r.commit_sha)).toEqual(b.rows.map((r) => r.commit_sha));
    for (const row of a.rows) {
      expect(row.commit_sha.length).toBe(40);
      expect(row.author_engineer_id_hash.length).toBe(8);
    }
  });
});

function makeCtx(role: "admin" | "manager" | "engineer" | "auditor" | "viewer" = "manager"): Ctx {
  return {
    tenant_id: "test-tenant",
    actor_id: "test-actor",
    role,
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
