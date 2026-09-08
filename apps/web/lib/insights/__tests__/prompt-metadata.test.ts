import { describe, it, expect } from "vitest";
import { bucketForViewer } from "@/lib/insights/prompt-metadata";

describe("bucketForViewer", () => {
  const meta = {
    tsPrompt: new Date("2026-05-14T03:21:40.500Z"),
    wordCount: 47,
  };

  it("returns exact data when viewer is owner", () => {
    const out = bucketForViewer({ meta, isOwner: true, seed: "p1" });
    expect(out.tsPrompt).toBe("2026-05-14T03:21:40.500Z");
    expect(out.wordCount).toBe(47);
  });

  it("floors timestamp to the hour for non-owners", () => {
    const out = bucketForViewer({ meta, isOwner: false, seed: "p1" });
    expect(out.tsPrompt).toBe("2026-05-14T03:00:00.000Z");
  });

  it("jitters word count deterministically for non-owners", () => {
    const a = bucketForViewer({ meta, isOwner: false, seed: "p1" });
    const b = bucketForViewer({ meta, isOwner: false, seed: "p1" });
    const c = bucketForViewer({ meta, isOwner: false, seed: "p2" });
    expect(a.wordCount).toBe(b.wordCount);
    // Different seeds give different jitter (probably).
    expect([a.wordCount, c.wordCount]).toHaveLength(2);
  });

  it("never returns negative word counts", () => {
    const out = bucketForViewer({
      meta: { tsPrompt: new Date(), wordCount: 1 },
      isOwner: false,
      seed: "x",
    });
    expect(out.wordCount).toBeGreaterThanOrEqual(0);
  });
});
