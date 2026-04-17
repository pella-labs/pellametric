import { assertAllowedChannel, sseResponse } from "../_lib/stream";

/**
 * Hourly anomaly detector feed (source: Workstream H-AI). M1 emits heartbeats
 * only — the detector is not yet wired. Once Jorge's rolling baseline is in,
 * bind to the Redis Stream consumer and push each `{ kind: "anomaly", ... }`
 * payload shaped per contract 07.
 */
assertAllowedChannel("anomalies");

export function GET() {
  return sseResponse(() => {
    // No-op source for now. Returns a disposer so the stream can cancel cleanly.
    return () => {};
  });
}
