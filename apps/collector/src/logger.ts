import pino, { type Logger } from "pino";

/**
 * Structured JSON logger. Level via DEVMETRICS_LOG_LEVEL env var.
 * Default is "warn" to honor CLAUDE.md §Env vars "quiet by default".
 */
export const log: Logger = pino({
  level: process.env.DEVMETRICS_LOG_LEVEL || "warn",
  base: { service: "bematist-collector" },
});
