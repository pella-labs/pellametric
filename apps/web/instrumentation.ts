/**
 * Next.js OTLP instrumentation hook.
 *
 * Registered automatically by Next when present at the project root. We keep
 * the body minimal and env-gated — observability sidecar is OPTIONAL per
 * CLAUDE.md Tech Stack (OPTIONAL; default deploy uses Bun ingest's native OTLP
 * receiver). When `OTEL_EXPORTER_OTLP_ENDPOINT` is set, we expect the runtime
 * to forward traces to it; otherwise this hook is a no-op.
 *
 * pino lives in `apps/web/lib/logger.ts` — see there for structured-log setup.
 */

export async function register() {
  if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
    // Dynamic import keeps the OTel SDK out of the default bundle. Wire when
    // operators opt in via env.
    // const { registerOTel } = await import("@vercel/otel");
    // registerOTel({ serviceName: "bematist-web" });
  }
}
