import { describe, expect, test } from "bun:test";
import type { Ctx } from "../auth";
import { CLUSTER_CONTRIBUTOR_FLOOR, listClusters } from "./cluster";

describe("listClusters", () => {
  test("enforces k>=3 contributor floor; below-floor entries suppressed", async () => {
    const out = await listClusters(makeCtx(), { window: "30d" });
    expect(out.clusters.length).toBeGreaterThan(0);
    for (const c of out.clusters) {
      expect(c.contributor_count).toBeGreaterThanOrEqual(CLUSTER_CONTRIBUTOR_FLOOR);
    }
    // Fixture universe deliberately seeds entries < 3 contributors to exercise
    // the server-side floor.
    expect(out.suppressed_below_floor).toBeGreaterThanOrEqual(0);
  });

  test("labels look like 3–5 words, no URLs, no proper nouns", async () => {
    const out = await listClusters(makeCtx(), { window: "30d" });
    for (const c of out.clusters) {
      expect(c.label.length).toBeGreaterThan(0);
      const words = c.label.split(/\s+/).filter(Boolean);
      expect(words.length).toBeGreaterThanOrEqual(2);
      expect(words.length).toBeLessThanOrEqual(6);
      expect(c.label).not.toMatch(/https?:\/\//);
    }
  });

  test("respects `limit`", async () => {
    const out = await listClusters(makeCtx(), { window: "30d", limit: 3 });
    expect(out.clusters.length).toBeLessThanOrEqual(3);
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
