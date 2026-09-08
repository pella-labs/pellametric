import { describe, it, expect } from "vitest";
import { prorateSessionAcrossDays } from "@/lib/lineage/proration";

describe("prorateSessionAcrossDays", () => {
  it("single-day session returns one slice", () => {
    const r = prorateSessionAcrossDays({
      startedAt: new Date("2026-05-13T10:00:00Z"),
      endedAt: new Date("2026-05-13T11:00:00Z"),
      tokensOut: 1000,
      messages: 20,
      errors: 2,
      teacherMoments: 1,
      frustrationSpikes: 0,
    });
    expect(r).toHaveLength(1);
    expect(r[0].day).toBe("2026-05-13");
    expect(r[0].tokensOut).toBe(1000);
    expect(r[0].messages).toBe(20);
  });

  it("splits across UTC midnight, tokens stay on startedAt day (P12)", () => {
    const r = prorateSessionAcrossDays({
      startedAt: new Date("2026-05-13T23:30:00Z"),
      endedAt: new Date("2026-05-14T00:30:00Z"),
      tokensOut: 1000,
      messages: 60,
      errors: 0,
      teacherMoments: 0,
      frustrationSpikes: 0,
    });
    expect(r).toHaveLength(2);
    expect(r[0].day).toBe("2026-05-13");
    expect(r[1].day).toBe("2026-05-14");
    expect(r[0].tokensOut).toBe(1000);
    expect(r[1].tokensOut).toBe(0);
    // Equal halves: messages prorate ~30/30.
    expect(r[0].messages + r[1].messages).toBeGreaterThanOrEqual(59);
  });

  it("clips to 2h SESSION_CAP", () => {
    const r = prorateSessionAcrossDays({
      startedAt: new Date("2026-05-13T10:00:00Z"),
      endedAt: new Date("2026-05-13T22:00:00Z"), // 12h raw
      tokensOut: 500,
      messages: 100,
      errors: 0,
      teacherMoments: 0,
      frustrationSpikes: 0,
    });
    const totalSec = r.reduce((s, d) => s + d.activeSecondsClipped, 0);
    expect(totalSec).toBe(2 * 3600);
  });
});
