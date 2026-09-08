// Pure-helper tests covering the F0 critical-bug fixes C1, C2, C3.
// The DB-orchestrating callers (refresh-cost-per-pr, refresh-daily-org-stats)
// delegate to these helpers, so the bug regressions are gated here.

import { describe, it, expect } from "vitest";
import {
  subtractOverlap,
  priceVersionFromMaxCreatedAt,
  buildDailyOrgStatsRows,
  META_SOURCE,
  type SessionLink,
  type SessionTokens,
  type PerSourceSum,
} from "@/lib/insights/rollup-math";

describe("subtractOverlap (C2 — stacked-PR token subtraction)", () => {
  const t = (id: string, n: number): SessionTokens => ({
    id,
    tokensIn: n,
    tokensOut: n,
    tokensCacheRead: n,
    tokensCacheWrite: n,
  });
  const link = (id: string, c: SessionLink["confidence"] = "high"): SessionLink => ({
    sessionEventId: id,
    confidence: c,
  });

  it("subtracts only sessions present in BOTH parent and child link sets", () => {
    const parent = { tokensIn: 100, tokensOut: 100, tokensCacheRead: 100, tokensCacheWrite: 100 };
    const parentLinks = [link("s1"), link("s2")];                       // parent saw s1, s2
    const childLinks = [link("s1"), link("s3")];                        // child saw s1, s3
    const childSessions = [t("s1", 30), t("s3", 50)];                   // worker fetched both
    const out = subtractOverlap(parent, parentLinks, childLinks, childSessions);
    // Only s1 (the overlap) should be subtracted, NOT s3 — which was never linked
    // to the parent in the first place. The pre-fix code subtracted both and
    // hid it with a clamp-to-zero.
    expect(out).toEqual({
      tokensIn: 70,
      tokensOut: 70,
      tokensCacheRead: 70,
      tokensCacheWrite: 70,
    });
  });

  it("ignores child links with confidence='low'", () => {
    const parent = { tokensIn: 100, tokensOut: 100, tokensCacheRead: 100, tokensCacheWrite: 100 };
    const parentLinks = [link("s1")];
    const childLinks = [link("s1", "low")];
    const childSessions = [t("s1", 80)];
    const out = subtractOverlap(parent, parentLinks, childLinks, childSessions);
    // Low-confidence child links are not counted as cost-bearing → no subtract.
    expect(out.tokensIn).toBe(100);
  });

  it("subtracts each overlap session once even if it appears in multiple child links", () => {
    const parent = { tokensIn: 100, tokensOut: 100, tokensCacheRead: 100, tokensCacheWrite: 100 };
    const parentLinks = [link("s1")];
    const childLinks = [link("s1"), link("s1", "medium")];
    // childSessions array dedup is the caller's job; we pass a single row.
    const childSessions = [t("s1", 40)];
    const out = subtractOverlap(parent, parentLinks, childLinks, childSessions);
    expect(out.tokensIn).toBe(60);
  });

  it("returns parent unchanged when there is no overlap", () => {
    const parent = { tokensIn: 100, tokensOut: 50, tokensCacheRead: 0, tokensCacheWrite: 0 };
    const out = subtractOverlap(parent, [link("s1")], [link("s2")], [t("s2", 999)]);
    expect(out).toEqual(parent);
  });

  it("does not mutate inputs", () => {
    const parent = { tokensIn: 100, tokensOut: 100, tokensCacheRead: 100, tokensCacheWrite: 100 };
    const snapshot = { ...parent };
    subtractOverlap(parent, [link("s1")], [link("s1")], [t("s1", 30)]);
    expect(parent).toEqual(snapshot);
  });
});

describe("priceVersionFromMaxCreatedAt (C1 — monotonic price version)", () => {
  it("returns 0 when no pricing rows matched", () => {
    expect(priceVersionFromMaxCreatedAt(null)).toBe(0);
  });

  it("returns epoch seconds (monotonic with createdAt)", () => {
    const a = new Date("2026-01-01T00:00:00Z");
    const b = new Date("2026-02-01T00:00:00Z");
    const c = new Date("2026-03-01T00:00:00Z");
    const va = priceVersionFromMaxCreatedAt(a);
    const vb = priceVersionFromMaxCreatedAt(b);
    const vc = priceVersionFromMaxCreatedAt(c);
    expect(vb).toBeGreaterThan(va);
    expect(vc).toBeGreaterThan(vb);
  });

  it("matches Math.floor of getTime/1000", () => {
    const d = new Date("2026-05-14T03:21:40.500Z");
    expect(priceVersionFromMaxCreatedAt(d)).toBe(Math.floor(d.getTime() / 1000));
  });
});

describe("buildDailyOrgStatsRows (C3 — PR counts via _meta row)", () => {
  const baseSum: PerSourceSum = {
    source: "claude",
    sessions: 5,
    activeHoursCenti: 100,
    tokensIn: 1000,
    tokensOut: 500,
    tokensCacheRead: 0,
    tokensCacheWrite: 0,
  };

  it("zeroes PR counts on every per-source row and concentrates them on _meta", () => {
    const rows = buildDailyOrgStatsRows(
      [baseSum, { ...baseSum, source: "codex", tokensIn: 200 }],
      { prsMerged: 7, prsMergedAiAssisted: 5, prsMergedBot: 1, prsReverted: 2 },
    );
    const perSource = rows.filter(r => r.source !== META_SOURCE);
    const meta = rows.find(r => r.source === META_SOURCE);
    expect(perSource).toHaveLength(2);
    for (const r of perSource) {
      expect(r.prsMerged).toBe(0);
      expect(r.prsMergedAiAssisted).toBe(0);
      expect(r.prsMergedBot).toBe(0);
      expect(r.prsReverted).toBe(0);
    }
    expect(meta).toBeDefined();
    expect(meta!.prsMerged).toBe(7);
    expect(meta!.prsMergedAiAssisted).toBe(5);
    expect(meta!.prsMergedBot).toBe(1);
    expect(meta!.prsReverted).toBe(2);
    // _meta row carries no per-source token totals.
    expect(meta!.tokensIn).toBe(0);
    expect(meta!.sessions).toBe(0);
  });

  it("always emits the _meta row even when no sources are active", () => {
    const rows = buildDailyOrgStatsRows([], { prsMerged: 3, prsMergedAiAssisted: 0, prsMergedBot: 0, prsReverted: 0 });
    expect(rows).toHaveLength(1);
    expect(rows[0].source).toBe(META_SOURCE);
    expect(rows[0].prsMerged).toBe(3);
  });

  it("preserves per-source token + session totals", () => {
    const rows = buildDailyOrgStatsRows(
      [baseSum],
      { prsMerged: 0, prsMergedAiAssisted: 0, prsMergedBot: 0, prsReverted: 0 },
    );
    const claude = rows.find(r => r.source === "claude")!;
    expect(claude.sessions).toBe(5);
    expect(claude.tokensIn).toBe(1000);
    expect(claude.tokensOut).toBe(500);
    expect(claude.activeHoursCenti).toBe(100);
  });

  it("drops any incoming row whose source is already _meta (defensive)", () => {
    const rows = buildDailyOrgStatsRows(
      [{ ...baseSum, source: META_SOURCE, tokensIn: 9999 }, baseSum],
      { prsMerged: 1, prsMergedAiAssisted: 0, prsMergedBot: 0, prsReverted: 0 },
    );
    const metas = rows.filter(r => r.source === META_SOURCE);
    expect(metas).toHaveLength(1);
    // The synthetic _meta wins; rogue input is discarded.
    expect(metas[0].tokensIn).toBe(0);
  });

  it("regression: SUM(prsMerged) across all rows equals prsMerged, not N×prsMerged", () => {
    // The pre-fix bug duplicated PR counts on every source row, so summing
    // across rows over-counted by the number of active sources.
    const rows = buildDailyOrgStatsRows(
      [
        { ...baseSum, source: "claude" },
        { ...baseSum, source: "codex" },
        { ...baseSum, source: "cursor" },
      ],
      { prsMerged: 4, prsMergedAiAssisted: 0, prsMergedBot: 0, prsReverted: 0 },
    );
    const sum = rows.reduce((acc, r) => acc + r.prsMerged, 0);
    expect(sum).toBe(4);
  });
});
