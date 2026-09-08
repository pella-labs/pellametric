// F4.34 / P33 — prompt-metadata bucketing helper. When a manager reads prompt
// metadata for someone else's session, exact timestamps are bucketed to the
// hour and word counts are jittered by ±30s-equivalent (i.e. ±10 words) so
// cross-referencing N queries cannot uniquely identify a specific prompt.
//
// Owners still see exact timestamps + word counts.

export type PromptMetaIn = {
  tsPrompt: Date;
  wordCount: number;
};

export type PromptMetaOut = {
  /** Hour-aligned ISO string when non-owner; exact when owner. */
  tsPrompt: string;
  /** Jittered when non-owner; exact when owner. */
  wordCount: number;
};

/**
 * Floor a date to the start of the UTC hour.
 */
function floorHour(d: Date): Date {
  const c = new Date(d);
  c.setUTCMinutes(0, 0, 0);
  return c;
}

/**
 * Deterministic jitter from a stable seed (e.g. promptId). Same prompt always
 * produces the same word-count delta so a manager refreshing the page does
 * not gather variance points across reads.
 */
function deterministicJitter(seed: string, range: number): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return ((h % (2 * range + 1)) - range);
}

export function bucketForViewer({
  meta,
  isOwner,
  seed,
}: {
  meta: PromptMetaIn;
  isOwner: boolean;
  seed: string;
}): PromptMetaOut {
  if (isOwner) {
    return {
      tsPrompt: meta.tsPrompt.toISOString(),
      wordCount: meta.wordCount,
    };
  }
  return {
    tsPrompt: floorHour(meta.tsPrompt).toISOString(),
    wordCount: Math.max(0, meta.wordCount + deterministicJitter(seed, 10)),
  };
}
