import { assertAllowedChannel, sseResponse } from "../_lib/stream";

/**
 * Collector-health telemetry feed (contract 07 §SSE) — device-level only.
 * Payloads shaped `{ kind: "collector", device_id, status, fidelity, version,
 * last_event_at }`. M1 is heartbeat-only; Workstream B's collector-ping
 * writer lands the real events.
 */
assertAllowedChannel("collector_health");

export function GET() {
  return sseResponse(() => {
    return () => {};
  });
}
