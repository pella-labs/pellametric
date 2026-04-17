import { describe, expect, test } from "bun:test";
import type { Ctx } from "../auth";
import type { PipelineInsight } from "../schemas/insights";
import { filterByConfidence, getWeeklyDigest } from "./insights";

describe("filterByConfidence", () => {
  test("drops every low-confidence entry and counts them", () => {
    const pipeline: PipelineInsight[] = [
      insight("a", "high"),
      insight("b", "medium"),
      insight("c", "low"),
      insight("d", "low"),
      insight("e", "high"),
    ];
    const result = filterByConfidence(pipeline);
    expect(result.dropped).toBe(2);
    expect(result.insights.map((i) => i.id)).toEqual(["a", "b", "e"]);
    // Type narrows to "high" | "medium" — no "low" survives.
    for (const kept of result.insights) {
      expect(kept.confidence === "high" || kept.confidence === "medium").toBe(true);
    }
  });

  test("empty pipeline → empty insights, 0 dropped", () => {
    const result = filterByConfidence([]);
    expect(result.insights).toEqual([]);
    expect(result.dropped).toBe(0);
  });

  test("all-low pipeline → all dropped, no insights ship", () => {
    const pipeline: PipelineInsight[] = [insight("a", "low"), insight("b", "low")];
    const result = filterByConfidence(pipeline);
    expect(result.insights).toEqual([]);
    expect(result.dropped).toBe(2);
  });
});

describe("getWeeklyDigest", () => {
  test("fixture pipeline drops its seeded low-confidence insight", async () => {
    const out = await getWeeklyDigest(makeCtx(), {});
    expect(out.dropped_low_confidence).toBeGreaterThanOrEqual(1);
    expect(out.insights.length).toBeGreaterThan(0);
    for (const i of out.insights) {
      expect(i.confidence === "high" || i.confidence === "medium").toBe(true);
    }
  });

  test("citations are non-empty for insights that cite clusters", async () => {
    const out = await getWeeklyDigest(makeCtx(), {});
    const withCitations = out.insights.filter((i) => i.citations.length > 0);
    expect(withCitations.length).toBeGreaterThan(0);
    for (const i of withCitations) {
      for (const c of i.citations) {
        expect(c.id.length).toBeGreaterThan(0);
        expect(c.label.length).toBeGreaterThan(0);
      }
    }
  });
});

function insight(id: string, confidence: "high" | "medium" | "low"): PipelineInsight {
  return {
    id,
    title: `insight ${id}`,
    body: `body ${id}`,
    confidence,
    subject_kind: "efficiency",
    citations: [],
  };
}

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
