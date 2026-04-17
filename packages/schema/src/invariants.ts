// Single-source forbidden-field list (Sprint-1 Phase-2 I1).
//
// Contract 08 §Forbidden-field rejection is the authoritative source; contract
// 01 §Invariant #4 is aligned via the Phase-2 changelog line. Both contracts and
// this file diff against each other in packages/schema/src/invariants.test.ts.
//
// Anything here change — update BOTH contracts and re-run `bun test`; the
// contract-parity test will regex-extract the contract-08 list and block CI on
// drift.
//
// See CLAUDE.md §API Rules, §Security Rules, PRD D-S1-25, D-S1-30.

export const FORBIDDEN_FIELDS: readonly string[] = [
  "rawPrompt",
  "prompt",
  "prompt_text",
  "messages",
  "toolArgs",
  "toolOutputs",
  "fileContents",
  "diffs",
  "filePaths",
  "ticketIds",
  "emails",
  "realNames",
] as const;

export const FORBIDDEN_FIELDS_SET: ReadonlySet<string> = new Set(FORBIDDEN_FIELDS);

/**
 * Recursive DFS key-name scan over plain objects + arrays.
 *
 * - Returns the first forbidden key encountered, or `null`.
 * - Uses a WeakSet to guard against circular graphs; repeated visits are skipped.
 * - Does NOT descend into primitives (strings, numbers, bools, null/undefined),
 *   Date, Buffer, Map, Set, or class instances other than plain Array / Object.
 *   The ingest wire format is JSON; non-plain values cannot appear.
 *
 * Pre-zod ordering (see apps/ingest/src/tier/enforceTier.ts): this runs BEFORE
 * `EventSchema.safeParse` so that a forbidden field is rejected with 400
 * `FORBIDDEN_FIELD` instead of a generic zod error.
 */
export function containsForbiddenField(obj: unknown): string | null {
  const seen = new WeakSet<object>();

  function visit(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    if (typeof value !== "object") return null;
    // Any object — plain or array. WeakSet guard against cycles.
    if (seen.has(value as object)) return null;
    seen.add(value as object);

    if (Array.isArray(value)) {
      for (const item of value) {
        const hit = visit(item);
        if (hit !== null) return hit;
      }
      return null;
    }

    // Plain object — iterate own enumerable keys in insertion order.
    for (const key of Object.keys(value as Record<string, unknown>)) {
      if (FORBIDDEN_FIELDS_SET.has(key)) return key;
      const hit = visit((value as Record<string, unknown>)[key]);
      if (hit !== null) return hit;
    }
    return null;
  }

  return visit(obj);
}
