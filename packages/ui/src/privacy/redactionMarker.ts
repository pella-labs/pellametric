/**
 * Redaction-marker parsing utilities.
 *
 * The server-authoritative redactor (packages/redact — contract 08) replaces
 * sensitive substrings with `<REDACTED:type:hash>` markers. The format is
 * regex-stable on purpose so dashboard renderers can detect and style them
 * without re-scanning.
 *
 * This module owns the regex and the `MarkerMatch` type. Import from here —
 * do NOT redefine the regex in components.
 */

/**
 * Types mirror `RedactionMarker.type` in `contracts/08-redaction.md`.
 */
export type RedactionType =
  | "secret"
  | "email"
  | "phone"
  | "name"
  | "ip"
  | "credit_card"
  | "ssn"
  | "url"
  | "address"
  | "other";

export interface MarkerMatch {
  raw: string;
  type: RedactionType;
  hash: string;
  /** Index into the original string where the marker starts. */
  start: number;
  /** End index, exclusive. */
  end: number;
}

/**
 * Matches `<REDACTED:type:hash>` markers. `type` is a lowercase-alpha+underscore
 * token; `hash` is the 16-char hex slice from `sha256(original).slice(0, 16)`.
 */
export const REDACTION_MARKER_REGEX = /<REDACTED:([a-z_]+):([0-9a-f]{16})>/g;

const KNOWN_TYPES = new Set<RedactionType>([
  "secret",
  "email",
  "phone",
  "name",
  "ip",
  "credit_card",
  "ssn",
  "url",
  "address",
  "other",
]);

function coerceType(raw: string): RedactionType {
  return KNOWN_TYPES.has(raw as RedactionType) ? (raw as RedactionType) : "other";
}

/**
 * Scan `text` for redaction markers. Returns each match with its indices so
 * callers can rebuild the string with rendered chips in place.
 */
export function findMarkers(text: string): MarkerMatch[] {
  const matches: MarkerMatch[] = [];
  // Regex has the /g flag — reset lastIndex defensively.
  REDACTION_MARKER_REGEX.lastIndex = 0;
  for (const m of text.matchAll(REDACTION_MARKER_REGEX)) {
    if (m.index === undefined) continue;
    const [raw, typeRaw, hash] = m;
    if (!typeRaw || !hash) continue;
    matches.push({
      raw,
      type: coerceType(typeRaw),
      hash,
      start: m.index,
      end: m.index + raw.length,
    });
  }
  return matches;
}
