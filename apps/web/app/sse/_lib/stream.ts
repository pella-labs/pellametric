import "server-only";

export interface SseEvent<T = unknown> {
  kind: string;
  payload?: T;
}

const ENCODER = new TextEncoder();

function formatEvent(event: SseEvent): Uint8Array {
  const lines = [`event: ${event.kind}`];
  if (event.payload !== undefined) {
    lines.push(`data: ${JSON.stringify(event.payload)}`);
  } else {
    lines.push("data: {}");
  }
  return ENCODER.encode(`${lines.join("\n")}\n\n`);
}

function formatHeartbeat(): Uint8Array {
  // Comment-line heartbeat per EventSource spec — keeps proxies from timing out.
  return ENCODER.encode(`: heartbeat ${new Date().toISOString()}\n\n`);
}

/**
 * Build an SSE `Response` that emits `source()` events and interleaves a
 * comment-line heartbeat every `heartbeatMs` so proxies don't idle-close.
 *
 * `source` receives a `push(event)` callback and should register its upstream
 * listener; it must return an `unsubscribe()` disposer that the stream invokes
 * on cancel.
 */
export function sseResponse(
  source: (push: (event: SseEvent) => void) => () => void,
  heartbeatMs = 15_000,
): Response {
  let unsubscribe: (() => void) | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const push = (event: SseEvent) => {
        try {
          controller.enqueue(formatEvent(event));
        } catch {
          // Client disconnected — cleanup will happen via cancel().
        }
      };
      unsubscribe = source(push);
      // Immediate hello heartbeat so clients see the stream open quickly.
      controller.enqueue(formatHeartbeat());
      heartbeatTimer = setInterval(() => {
        try {
          controller.enqueue(formatHeartbeat());
        } catch {
          // swallow; client gone
        }
      }, heartbeatMs);
    },
    cancel() {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      unsubscribe?.();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}

/**
 * Channel-name guard. The contract 07 §SSE invariants ban any per-engineer
 * event stream or live coding feed. We enforce this at runtime too — if a
 * route imports `assertAllowedChannel` with a banned name, we throw at module
 * load, failing the build loudly rather than shipping a panopticon surface.
 */
const BANNED_CHANNELS = new Set<string>([
  "engineer",
  "per_engineer",
  "session_ticks",
  "live_coding",
  "live_feed",
]);

export function assertAllowedChannel(name: string): void {
  if (BANNED_CHANNELS.has(name)) {
    throw new Error(
      `SSE channel '${name}' is banned by contract 07 — would constitute a real-time per-engineer event feed (panopticon non-goal).`,
    );
  }
}
