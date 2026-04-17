import "server-only";
import pino from "pino";

/**
 * Structured JSON logger for server-side routes. Configured once at module
 * load; each route imports `log` and tags its name via `log.child({route: ...})`.
 */
export const log = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: { service: "bematist-web" },
});
