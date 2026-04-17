import { FORBIDDEN_FIELDS } from "@bematist/schema";
import pino from "pino";

// Singleton pino logger. Level from LOG_LEVEL env (default "info").
// In test environments (Bun.jest / BUN_ENV=test) default to "silent" so
// the suite output isn't drowned in structured log lines.
const defaultLevel =
  process.env.NODE_ENV === "test" || process.env.BUN_ENV === "test" ? "silent" : "info";

// PRD §Phase 2, test #10: ensure no forbidden field value or Authorization
// header ever reaches disk.
//
// M8 fix: pino's `paths` wildcard is depth-bounded — `*.field` is depth-1,
// `*.*.field` is depth-2; there is no recursive `**.field` syntax. We
// generate rungs explicitly up to depth 5 (MAX_REDACT_DEPTH). Callers MUST
// NOT log objects deeper than 5 levels that could contain forbidden
// values — the invariant-scanner in Sprint 2 is the backstop. In practice
// our event body + request headers sit ≤3 levels deep; 5 is slack.
const MAX_REDACT_DEPTH = 5;
function rungs(field: string): string[] {
  const out: string[] = [];
  let prefix = "";
  for (let d = 1; d <= MAX_REDACT_DEPTH; d++) {
    prefix += "*.";
    out.push(`${prefix}${field}`);
  }
  return out;
}

export const redactPaths: string[] = [
  "req.headers.authorization",
  "headers.authorization",
  "authorization",
  // Forbidden fields at every depth 1..MAX_REDACT_DEPTH.
  ...FORBIDDEN_FIELDS.flatMap(rungs),
  // Tier-C content fields — every depth 1..MAX_REDACT_DEPTH.
  ...rungs("prompt_text"),
  ...rungs("tool_input"),
  ...rungs("tool_output"),
  ...rungs("raw_attrs"),
  // Top-level occurrences of the same keys.
  ...FORBIDDEN_FIELDS,
  "prompt_text",
  "tool_input",
  "tool_output",
  "raw_attrs",
];

export function makeLogger(destination?: pino.DestinationStream): pino.Logger {
  return pino(
    {
      level: process.env.LOG_LEVEL ?? defaultLevel,
      base: { svc: "bematist-ingest" },
      redact: { paths: redactPaths, censor: "[Redacted]" },
    },
    destination,
  );
}

export const logger: pino.Logger = makeLogger();
