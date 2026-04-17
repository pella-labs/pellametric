import { describe, expect, test } from "bun:test";
import type { Ctx } from "../auth";
import { listAlerts } from "./alerts";

describe("listAlerts", () => {
  test("returns alerts sorted critical > warn > info then newest-first", async () => {
    const out = await listAlerts(makeCtx("admin"), {
      window: "7d",
      min_severity: "info",
      limit: 100,
    });
    expect(out.alerts.length).toBeGreaterThan(0);
    const rank = { info: 0, warn: 1, critical: 2 } as const;
    for (let i = 1; i < out.alerts.length; i++) {
      const prev = out.alerts[i - 1]!;
      const curr = out.alerts[i]!;
      const rPrev = rank[prev.severity];
      const rCurr = rank[curr.severity];
      if (rPrev === rCurr) {
        expect(prev.triggered_at.localeCompare(curr.triggered_at)).toBeGreaterThanOrEqual(0);
      } else {
        expect(rPrev).toBeGreaterThanOrEqual(rCurr);
      }
    }
  });

  test("min_severity filter drops lower severities", async () => {
    const out = await listAlerts(makeCtx("manager"), {
      window: "7d",
      min_severity: "critical",
      limit: 100,
    });
    for (const a of out.alerts) expect(a.severity).toBe("critical");
    expect(out.counts_by_severity.info).toBe(0);
    expect(out.counts_by_severity.warn).toBe(0);
  });

  test("counts_by_severity matches the returned list", async () => {
    const out = await listAlerts(makeCtx("manager"), {
      window: "30d",
      min_severity: "info",
      limit: 100,
    });
    const counts = { info: 0, warn: 0, critical: 0 };
    for (const a of out.alerts) counts[a.severity] += 1;
    expect(out.counts_by_severity).toEqual(counts);
  });

  test("engineer role is rejected (alerts feed is not per-IC)", async () => {
    await expect(
      listAlerts(makeCtx("engineer"), { window: "7d", min_severity: "info", limit: 100 }),
    ).rejects.toThrow();
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
