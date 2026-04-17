// Tier-A `raw_attrs` allowlist (CLAUDE.md C10, contract 08 §Tier A allowlist).
//
// Tier-A events carry counts/durations only — NO content fields. The ingest
// validator filters `raw_attrs` to this allowlist AT WRITE TIME (not hopeful
// schema design). Anything not listed is dropped silently with a counter log.
//
// Keys with dots (`gen_ai.system`) are dotted paths into nested objects; the
// filter flattens the input structure and checks each leaf path against the
// allowlist.

export const TIER_A_RAW_ATTRS_ALLOWLIST: ReadonlySet<string> = new Set([
  "schema_version",
  "source",
  "source_version",
  "device.id",
  "service.version",
  "gen_ai.system",
  "gen_ai.request.model",
  "gen_ai.response.model",
  "dev_metrics.event_kind",
  "dev_metrics.tool_name",
  "dev_metrics.tool_status",
  "dev_metrics.duration_ms",
  "dev_metrics.first_try_failure",
]);

export interface FilterRawAttrsResult {
  filtered: Record<string, unknown> | undefined;
  dropped_keys: string[];
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== "object") return false;
  if (Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/**
 * Filter `raw_attrs` to the Tier-A allowlist (+ optional per-org extras).
 *
 * Allowlist entries are dotted paths (`gen_ai.system`). The filter walks the
 * input recursively:
 *
 * - If the leaf path joined with `.` is on the allowlist → keep.
 * - Otherwise → drop, record the dropped path in `dropped_keys`.
 *
 * A top-level key that literally contains a dot (e.g. the collector handed us
 * `{"device.id": "dev_1"}` rather than `{device: {id: "dev_1"}}`) is also
 * honoured — we compare the raw key string to the allowlist too.
 */
export function filterRawAttrs(
  attrs: Record<string, unknown> | undefined,
  extraAllowlist: readonly string[] = [],
): FilterRawAttrsResult {
  if (attrs === undefined) return { filtered: undefined, dropped_keys: [] };
  const merged = new Set<string>([...TIER_A_RAW_ATTRS_ALLOWLIST, ...extraAllowlist]);
  const dropped: string[] = [];

  function walk(input: Record<string, unknown>, prefix: string[]): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(input)) {
      const path = [...prefix, key].join(".");
      const value = input[key];
      if (merged.has(path)) {
        // Allowed — keep the value unchanged (no further recursion).
        out[key] = value;
        continue;
      }
      // Not allowed at THIS path. If the value is a plain object, recurse —
      // sub-fields may be allowlisted under dotted paths.
      if (isPlainObject(value)) {
        const sub = walk(value, [...prefix, key]);
        if (Object.keys(sub).length > 0) {
          out[key] = sub;
        }
      } else {
        dropped.push(path);
      }
    }
    return out;
  }

  const filtered = walk(attrs, []);
  return { filtered, dropped_keys: dropped };
}
