import pino, { type Logger } from "pino";

/**
 * Structured JSON logger. Level via BEMATIST_LOG_LEVEL env var (legacy
 * DEVMETRICS_LOG_LEVEL honored as fallback).
 * Default is "warn" to honor CLAUDE.md §Env vars "quiet by default".
 */
export const log: Logger = pino({
  level: process.env.BEMATIST_LOG_LEVEL || process.env.DEVMETRICS_LOG_LEVEL || "warn",
  base: { service: "bematist-collector" },
});
