import { describe, expect, test } from "bun:test";
import { buildPlan, generateDayForDev } from "./generate";
import { Rng } from "./rng";

describe("perf seed generator", () => {
  test("buildPlan: 3 orgs, 100 devs, 90 days × 100 ev = 900k headline shape", () => {
    const plan = buildPlan(new Rng());
    expect(plan.orgs).toHaveLength(3);
    expect(plan.devs).toHaveLength(100);
    expect(plan.days).toBe(90);
    expect(plan.eventsPerDevPerDay).toBe(100);
    expect(plan.devs.filter((d) => d.orgSlug === "acmesmall")).toHaveLength(7);
    expect(plan.devs.filter((d) => d.orgSlug === "boltmid")).toHaveLength(33);
    expect(plan.devs.filter((d) => d.orgSlug === "cruxlarge")).toHaveLength(60);
  });

  test("buildPlan is deterministic across runs (same seed)", () => {
    const a = buildPlan(new Rng(0xdecaf));
    const b = buildPlan(new Rng(0xdecaf));
    expect(a.orgs[0]?.id).toBe(b.orgs[0]?.id);
    expect(a.devs.map((d) => d.engineerId)).toEqual(b.devs.map((d) => d.engineerId));
  });

  test("engineer ids are unique and stable-hash-shaped", () => {
    const plan = buildPlan(new Rng());
    const ids = new Set(plan.devs.map((d) => d.engineerId));
    expect(ids.size).toBe(plan.devs.length);
    for (const id of ids) {
      expect(id).toMatch(/^eng_[a-z-]+_\d{3}$/);
    }
  });

  test("generateDayForDev: produces requested row count", () => {
    const rng = new Rng();
    const plan = buildPlan(rng);
    const dev = plan.devs[0]!;
    const day = plan.startDay;
    const rows = Array.from(generateDayForDev(rng, dev, day, 100));
    expect(rows).toHaveLength(100);
  });

  test("generateDayForDev: every row passes shape invariants", () => {
    const rng = new Rng();
    const plan = buildPlan(rng);
    const dev = plan.devs[0]!;
    const rows = Array.from(generateDayForDev(rng, dev, plan.startDay, 200));
    for (const row of rows) {
      expect(row.org_id).toBe(dev.orgId);
      expect(row.engineer_id).toBe(dev.engineerId);
      expect(row.cost_usd).toBeGreaterThanOrEqual(0);
      expect(row.cost_usd).toBeLessThanOrEqual(8);
      expect(row.input_tokens).toBeGreaterThanOrEqual(0);
      expect(row.output_tokens).toBeGreaterThanOrEqual(0);
      expect(row.tier).toBe("B");
      expect(["A", "B", "C"]).toContain(row.tier);
      expect(row.client_event_id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
      expect(row.event_seq).toBeGreaterThanOrEqual(0);
    }
  });

  test("event-kind mix is roughly the documented weights (within ±5%)", () => {
    const rng = new Rng();
    const plan = buildPlan(rng);
    const rows: ReturnType<typeof generateDayForDev> extends Generator<infer T> ? T[] : never = [];
    for (const dev of plan.devs.slice(0, 5)) {
      for (const row of generateDayForDev(rng, dev, plan.startDay, 200)) {
        rows.push(row);
      }
    }
    const total = rows.length;
    const kinds = rows.reduce<Record<string, number>>((acc, r) => {
      // session_start/end both come from the "session_start" bucket
      const k = r.event_kind === "session_end" ? "session_start" : r.event_kind;
      acc[k] = (acc[k] ?? 0) + 1;
      return acc;
    }, {});
    expect((kinds.llm_request ?? 0) / total).toBeGreaterThan(0.55);
    expect((kinds.tool_call ?? 0) / total).toBeGreaterThan(0.08);
    expect((kinds.code_edit_decision ?? 0) / total).toBeGreaterThan(0.08);
  });

  test("cursor source emits cost_estimated badge", () => {
    const rng = new Rng();
    const plan = buildPlan(rng);
    const rows: ReturnType<typeof generateDayForDev> extends Generator<infer T> ? T[] : never = [];
    for (const dev of plan.devs.slice(0, 3)) {
      for (const row of generateDayForDev(rng, dev, plan.startDay, 100)) {
        rows.push(row);
      }
    }
    const cursorRows = rows.filter((r) => r.source === "cursor");
    if (cursorRows.length > 0) {
      expect(cursorRows.every((r) => r.cost_estimated === 1)).toBe(true);
      expect(cursorRows.every((r) => r.fidelity === "estimated")).toBe(true);
    }
  });

  test("session_id stable per (dev, day, session-index) — needed for dedup analysis", () => {
    const rng = new Rng(123);
    const plan = buildPlan(rng);
    const dev = plan.devs[0]!;
    const rows = Array.from(generateDayForDev(rng, dev, plan.startDay, 50));
    const sessionIds = new Set(rows.map((r) => r.session_id));
    expect(sessionIds.size).toBeLessThanOrEqual(4);
    for (const id of sessionIds) {
      expect(id).toMatch(/^sess_eng_[a-z-]+_\d{3}_\d{4}-\d{2}-\d{2}_\d$/);
    }
  });
});
