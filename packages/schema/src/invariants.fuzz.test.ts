// Sprint-1 Phase-2 forbidden-field fuzzer (PRD test #8, I1).
//
// For each (FORBIDDEN_FIELDS entry × Tier-A|B source), arbitrary-inject the
// forbidden key at a random depth (0..3) into a minimal valid Event envelope,
// and assert:
//
//   1. `containsForbiddenField` returns a forbidden key (not null).
//   2. `enforceTier(rawEvent, auth={tier: source}, orgPolicy)` rejects with
//      `{reject: true, status: 400, code: "FORBIDDEN_FIELD", field}`.
//
// fc.assert runs 100 iterations per (field × source); 12 × 2 combos = 2400
// total. PRD allows up to 1000 per combo — 100 keeps CI fast while still
// proving the invariant. A collision counter fails fast if the injected key
// collides with a pre-existing key in the base event in > 20% of runs
// (generator bug).

import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { enforceTier, type OrgPolicy } from "../../../apps/ingest/src/tier/enforceTier";
import { containsForbiddenField, FORBIDDEN_FIELDS } from "./invariants";

type TierAB = "A" | "B";

interface PlainObject {
  [k: string]: unknown;
}

function makeBaseEvent(tier: TierAB): PlainObject {
  return {
    client_event_id: crypto.randomUUID(),
    schema_version: 1,
    ts: "2026-04-16T12:00:00.000Z",
    tenant_id: "org_test",
    engineer_id: "eng_test",
    device_id: "dev_1",
    source: "claude-code",
    fidelity: "full",
    cost_estimated: false,
    tier,
    session_id: "sess_1",
    event_seq: 0,
    dev_metrics: { event_kind: "llm_request" },
    raw_attrs: {
      schema_version: 1,
      nested: { foo: "bar" },
    },
  };
}

const POLICY: OrgPolicy = {
  tier_c_managed_cloud_optin: false,
  tier_default: "B",
};

/**
 * Inject `{[field]: "X"}` into `obj` at `depth` levels of nesting.
 *
 * Uses explicit `nextInt` values (driven by fast-check's shrinking integers)
 * so the fuzzer is deterministic per seed. Picks a random candidate container
 * at each depth; if none exists it grows one.
 */
function injectAtDepth(
  obj: PlainObject,
  field: string,
  depth: number,
  nextInt: (max: number) => number,
): { mutated: PlainObject; collided: boolean } {
  const clone: PlainObject = JSON.parse(JSON.stringify(obj));

  let cursor: PlainObject | unknown[] = clone;
  for (let d = 0; d < depth; d++) {
    const candidates: Array<PlainObject | unknown[]> = [];
    if (Array.isArray(cursor)) {
      for (const v of cursor) {
        if (Array.isArray(v) || (v !== null && typeof v === "object")) {
          candidates.push(v as PlainObject | unknown[]);
        }
      }
    } else {
      for (const k of Object.keys(cursor)) {
        const v = (cursor as PlainObject)[k];
        if (Array.isArray(v) || (v !== null && typeof v === "object")) {
          candidates.push(v as PlainObject | unknown[]);
        }
      }
    }
    if (candidates.length === 0) {
      const fresh: PlainObject = {};
      if (Array.isArray(cursor)) {
        (cursor as unknown[]).push(fresh);
      } else {
        (cursor as PlainObject)[`__child_${d}`] = fresh;
      }
      cursor = fresh;
      continue;
    }
    const idx = nextInt(candidates.length);
    const picked = candidates[idx];
    if (picked === undefined) {
      throw new Error("unreachable: candidate index out of range");
    }
    cursor = picked;
  }

  let collided = false;
  if (Array.isArray(cursor)) {
    cursor.push({ [field]: "X" });
  } else {
    const obj2 = cursor as PlainObject;
    if (Object.hasOwn(obj2, field)) collided = true;
    obj2[field] = "X";
  }
  return { mutated: clone, collided };
}

describe("fuzzer: FORBIDDEN_FIELDS × Tier A|B → reject 400", () => {
  for (const source of ["A", "B"] as const) {
    for (const field of FORBIDDEN_FIELDS) {
      test(`(${source} × ${field}) 100 iterations → reject 400 FORBIDDEN_FIELD`, async () => {
        let collisions = 0;
        let iterations = 0;

        // fc.tuple of (depth, picker-seed) — the picker-seed is a large integer
        // consumed by injectAtDepth to pick a candidate container deterministically.
        const arb = fc.tuple(
          fc.integer({ min: 0, max: 3 }),
          fc.integer({ min: 0, max: 2 ** 31 - 1 }),
        );

        await fc.assert(
          fc.asyncProperty(arb, async ([depth, pickerSeed]) => {
            iterations++;
            // Seeded deterministic "nextInt" from pickerSeed.
            let state = pickerSeed >>> 0;
            const nextInt = (max: number): number => {
              // xorshift32 — good enough for test-data picking.
              state ^= state << 13;
              state ^= state >>> 17;
              state ^= state << 5;
              state >>>= 0;
              return max === 0 ? 0 : state % max;
            };

            const { mutated, collided } = injectAtDepth(
              makeBaseEvent(source),
              field,
              depth,
              nextInt,
            );
            if (collided) {
              collisions++;
              return true; // accept — fc will re-generate
            }

            // (1) containsForbiddenField returns a forbidden key.
            const hit = containsForbiddenField(mutated);
            if (hit === null) return false;
            if (!FORBIDDEN_FIELDS.includes(hit)) return false;

            // (2) enforceTier rejects 400 FORBIDDEN_FIELD.
            const res = await enforceTier(mutated, { tier: source, tenantId: "org_test" }, POLICY);
            if (res.reject !== true) return false;
            if (res.status !== 400) return false;
            if (res.code !== "FORBIDDEN_FIELD") return false;
            return typeof res.field === "string" && FORBIDDEN_FIELDS.includes(res.field);
          }),
          { numRuns: 100, seed: 20260416, verbose: false },
        );
        expect(collisions / Math.max(1, iterations)).toBeLessThan(0.2);
      });
    }
  }
});
