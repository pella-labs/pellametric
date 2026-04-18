// Common shapes shared by the three detection engines.
//
// Engines are pure, deterministic functions: `scan(text)` → finds. The
// orchestrator (../orchestrator.ts) composes them and replaces matched spans
// with `<REDACTED:type:hash>` markers per contract 08.

import type { RedactionMarker } from "../stage";

/** A contiguous match span from one engine, pre-replacement. */
export interface Find {
  /** Inclusive UTF-16 start index. */
  start: number;
  /** Exclusive UTF-16 end index. */
  end: number;
  /** Marker type written to the chip (`secret`, `email`, …). */
  type: RedactionMarker["type"];
  /** Which engine found it. */
  detector: RedactionMarker["detector"];
  /** Rule name — e.g. "AWSAccessKey", "SlackWebhook", "GenericEmail". */
  rule: string;
  /** The matched substring (never logged outside the side-log). */
  value: string;
}

export interface Engine {
  /** Stable human-readable name for logs / fixtures. */
  readonly name: RedactionMarker["detector"];
  scan(text: string): Find[];
}
