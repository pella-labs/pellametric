import { FORBIDDEN_FIELDS } from "@bematist/schema";
import pino from "pino";

// Singleton pino logger. Level from LOG_LEVEL env (default "info").
// In test environments (Bun.jest / BUN_ENV=test) default to "silent" so
// the suite output isn't drowned in structured log lines.
const defaultLevel =
  process.env.NODE_ENV === "test" || process.env.BUN_ENV === "test" ? "silent" : "info";

// PRD §Phase 2, test #10: ensure no forbidden field value or Authorization
// header ever reaches disk. `paths` uses pino's wildcard syntax; "*.field"
// matches `{any: {field: ...}}`, "*.*.field" matches two levels of nesting.
// Sprint-2 will audit log lines against an invariant scanner — this is
// defense-in-depth for that scanner.
export const redactPaths: string[] = [
  "req.headers.authorization",
  "headers.authorization",
  "authorization",
  ...FORBIDDEN_FIELDS.map((f) => `*.${f}`),
  ...FORBIDDEN_FIELDS.map((f) => `*.*.${f}`),
  // Tier-C content fields — never log raw even inside {body: {...}}.
  "prompt_text",
  "tool_input",
  "tool_output",
  "raw_attrs",
  ...FORBIDDEN_FIELDS, // top-level keys (e.g. "messages", "rawPrompt")
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
