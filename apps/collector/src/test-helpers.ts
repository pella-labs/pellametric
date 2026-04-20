// Shared test helpers for the streaming-emit Adapter contract.
//
// Background: as of the 2026-04-19 streaming refactor, Adapter.poll emits
// events via a callback instead of returning Event[]. Tests that want the
// pre-refactor "give me a flat array" ergonomics call collectPoll() /
// collectParse() — they preserve the old assertion shape without hiding
// the streaming semantics from production code.

import type { Event } from "@bematist/schema";
import type {
  Adapter,
  AdapterContext,
  VSCodeExtensionContext,
  VSCodeExtensionHandler,
} from "@bematist/sdk";

export async function collectPoll(
  adapter: Adapter,
  ctx: AdapterContext,
  signal: AbortSignal = new AbortController().signal,
): Promise<Event[]> {
  const out: Event[] = [];
  await adapter.poll(ctx, signal, (e) => out.push(e));
  return out;
}

export async function collectParse(
  handler: VSCodeExtensionHandler,
  ctx: VSCodeExtensionContext,
  filePath: string,
  signal: AbortSignal = new AbortController().signal,
): Promise<Event[]> {
  const out: Event[] = [];
  await handler.parse(ctx, filePath, signal, (e) => out.push(e));
  return out;
}
