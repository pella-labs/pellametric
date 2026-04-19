import { statSync } from "node:fs";
import type { Event } from "@bematist/schema";
import type { Adapter, AdapterContext, AdapterHealth } from "@bematist/sdk";
import { type ContinueDiscovery, discoverSources } from "./discovery";
import {
  normalizeChatInteraction,
  normalizeEditOutcome,
  normalizeTokensGenerated,
  normalizeToolUsage,
} from "./normalize";
import {
  type ParsedStream,
  parseChatInteractionStream,
  parseEditOutcomeStream,
  parseTokensGeneratedStream,
  parseToolUsageStream,
} from "./parseStream";
import { CONTINUE_STREAM_NAMES, type ContinueStreamName } from "./paths";

const SOURCE_VERSION_DEFAULT = "0.2.0";

interface Identity {
  tenantId: string;
  engineerId: string;
  deviceId: string;
}

interface PendingCursor {
  stream: ContinueStreamName;
  offset: number;
  inode: string | null;
}

/**
 * Continue.dev adapter (D23 — first OSS parser of Continue's 4 dev-data streams).
 *
 * Reads `~/.continue/dev_data/0.2.0/{chatInteraction,tokensGenerated,editOutcome,toolUsage}.jsonl`.
 * One adapter, four correlated cursors — one per stream. Each cursor stores
 * the byte offset of the last consumed newline plus the file's inode (so
 * rotation is detected even when a new file happens to be >= the stored
 * offset). Cursor writes commit atomically via `ctx.cursor.setMany(...)` —
 * if any parse step or write throws, NO cursor advances and the next poll
 * re-tails from the prior state. Without this, a mid-flush crash would
 * leave cursors divergent and break `event_seq` ordering per stream.
 *
 * Fidelity: `full` — Continue emits native accept/reject in `editOutcome`,
 * which is the richest cross-tool attribution signal in the v1 lineup.
 */
export class ContinueDevAdapter implements Adapter {
  readonly id = "continue";
  readonly label = "Continue.dev";
  readonly version = "0.1.0";
  readonly supportedSourceVersions = ">=1.0.0";

  private sources: ContinueDiscovery | null = null;

  constructor(private readonly identity: Identity) {}

  async init(ctx: AdapterContext): Promise<void> {
    this.sources = discoverSources();
    ctx.log.info("continue-dev adapter init", {
      baseDir: this.sources.baseDir,
      baseDirExists: this.sources.baseDirExists,
      streamsPresent: Object.values(this.sources.streams).filter((s) => s.exists).length,
    });
  }

  async poll(ctx: AdapterContext, _signal: AbortSignal): Promise<Event[]> {
    const s = this.sources ?? discoverSources();
    if (!s.baseDirExists) return [];

    const identity = { ...this.identity, tier: ctx.tier };

    // Parse every stream BEFORE any cursor advances. Each stream's worth of
    // events is accumulated with its pending cursor update; only if the full
    // sweep completes successfully do we flush all four cursor pairs to the
    // store in a single atomic `setMany` call (Bug #1 fix).
    const out: Event[] = [];
    const pending: PendingCursor[] = [];

    out.push(
      ...(await this.pollStream(
        ctx,
        s,
        "chatInteraction",
        parseChatInteractionStream,
        (lines) => normalizeChatInteraction(lines, identity, SOURCE_VERSION_DEFAULT),
        pending,
      )),
    );
    out.push(
      ...(await this.pollStream(
        ctx,
        s,
        "tokensGenerated",
        parseTokensGeneratedStream,
        (lines) => normalizeTokensGenerated(lines, identity, SOURCE_VERSION_DEFAULT),
        pending,
      )),
    );
    out.push(
      ...(await this.pollStream(
        ctx,
        s,
        "editOutcome",
        parseEditOutcomeStream,
        (lines) => normalizeEditOutcome(lines, identity, SOURCE_VERSION_DEFAULT),
        pending,
      )),
    );
    out.push(
      ...(await this.pollStream(
        ctx,
        s,
        "toolUsage",
        parseToolUsageStream,
        (lines) => normalizeToolUsage(lines, identity, SOURCE_VERSION_DEFAULT),
        pending,
      )),
    );

    // All parsing succeeded — commit cursors atomically. If setMany throws
    // (disk-full, crash mid-flush, etc.) NO cursor advances and the whole
    // poll tick is a no-op for state purposes: the emitted events are
    // re-enqueued on the next poll, which is acceptable because the ingest
    // path dedups on `client_event_id` (Rule #2).
    await flushCursors(ctx, pending);

    return out;
  }

  async health(_ctx: AdapterContext): Promise<AdapterHealth> {
    const s = this.sources ?? discoverSources();
    const caveats: string[] = [];
    const present = Object.entries(s.streams)
      .filter(([, v]) => v.exists)
      .map(([k]) => k);
    const missing = Object.entries(s.streams)
      .filter(([, v]) => !v.exists)
      .map(([k]) => k);
    if (!s.baseDirExists) {
      caveats.push(
        `Continue dev_data dir missing (${s.baseDir}) — install Continue and enable telemetry to capture events.`,
      );
    } else if (missing.length > 0) {
      caveats.push(
        `Streams not yet present: ${missing.join(", ")}. They appear after Continue writes its first matching event.`,
      );
    }

    const status = s.baseDirExists && present.length > 0 ? "ok" : "disabled";
    return {
      status,
      fidelity: "full",
      ...(caveats.length > 0 ? { caveats } : {}),
    };
  }

  /**
   * Generic per-stream driver: read the stored (offset, inode), detect
   * rotation, parse new lines, normalize, and append a pending cursor
   * update. Never calls `ctx.cursor.set` directly — the caller flushes the
   * whole batch atomically at the end of `poll()`.
   */
  private async pollStream<L>(
    ctx: AdapterContext,
    s: ContinueDiscovery,
    stream: ContinueStreamName,
    parse: (path: string, offset: number) => Promise<ParsedStream<L>>,
    normalize: (lines: L[]) => Event[],
    pending: PendingCursor[],
  ): Promise<Event[]> {
    const spec = s.streams[stream];
    if (!spec.exists) return [];

    const prevOffset = await this.readOffset(ctx, stream);
    const prevInode = await this.readInode(ctx, stream);

    // Bug #2 fix — rotation detection. The inner `readLinesFromOffset`
    // already rewinds when `size < offset`, but that misses the case where
    // a rotated file happens to grow back past the old offset before the
    // next poll. Comparing inodes catches those too.
    let startOffset = prevOffset;
    let currentInode: string | null = null;
    try {
      const st = statSync(spec.path);
      currentInode = String(st.ino);
      if (st.size < prevOffset) {
        ctx.log.warn("continue-dev: stream truncated — resetting offset", {
          stream,
          prevOffset,
          newSize: st.size,
        });
        startOffset = 0;
      } else if (prevInode !== null && currentInode !== prevInode) {
        ctx.log.warn("continue-dev: stream inode changed — resetting offset", {
          stream,
          prevOffset,
          prevInode,
          currentInode,
        });
        startOffset = 0;
      }
    } catch {
      // stat failed; treat as missing-for-this-poll and leave state alone.
      return [];
    }

    const parsed = await parse(spec.path, startOffset);
    const events = normalize(parsed.lines);
    pending.push({ stream, offset: parsed.nextOffset, inode: currentInode });
    return events;
  }

  private async readOffset(ctx: AdapterContext, stream: ContinueStreamName): Promise<number> {
    const raw = await ctx.cursor.get(cursorKey(stream));
    if (!raw) return 0;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }

  private async readInode(ctx: AdapterContext, stream: ContinueStreamName): Promise<string | null> {
    const raw = await ctx.cursor.get(inodeKey(stream));
    if (!raw) return null;
    return raw;
  }
}

/**
 * Commit every pending (offset, inode) pair for this poll tick in a single
 * SQLite transaction. Falls back to sequential `set()` only when the host's
 * CursorStore does not implement `setMany`, preserving behavior for any
 * alternate transports that haven't adopted the batch primitive yet.
 *
 * Throwing here is load-bearing: the caller relies on a rejected promise to
 * keep the whole poll tick as a cursor-state no-op (Bug #1).
 */
async function flushCursors(ctx: AdapterContext, pending: PendingCursor[]): Promise<void> {
  if (pending.length === 0) return;

  const entries: Array<{ key: string; value: string }> = [];
  for (const p of pending) {
    entries.push({ key: cursorKey(p.stream), value: String(p.offset) });
    if (p.inode !== null) {
      entries.push({ key: inodeKey(p.stream), value: p.inode });
    }
  }

  if (typeof ctx.cursor.setMany === "function") {
    await ctx.cursor.setMany(entries);
    return;
  }

  // Fallback path — host CursorStore has no atomic batch. Best we can do is
  // sequential writes; this is the same divergence window the bug describes,
  // and will go away once every host adopts setMany. Logged so it's obvious
  // in prod logs that this path was taken.
  ctx.log.warn("continue-dev: CursorStore.setMany unavailable; falling back to sequential set", {
    entryCount: entries.length,
  });
  for (const e of entries) {
    await ctx.cursor.set(e.key, e.value);
  }
}

export function cursorKey(stream: ContinueStreamName): string {
  return `offset:continue:${stream}`;
}

export function inodeKey(stream: ContinueStreamName): string {
  return `inode:continue:${stream}`;
}

// Re-export stream name list so tests can iterate all four in one place.
export { CONTINUE_STREAM_NAMES };
