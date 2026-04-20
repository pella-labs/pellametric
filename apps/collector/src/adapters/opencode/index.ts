import { statSync } from "node:fs";
import type { Adapter, AdapterContext, AdapterHealth, EventEmitter } from "@bematist/sdk";
import { type DiscoverySources, discoverSources } from "./discovery";
import { normalizeSession } from "./normalize";
import { listLegacySessionIds, SkippedCounter } from "./skipped";
import { readSessionsSince } from "./sqlite";

const WATERMARK_KEY = "watermark:opencode";
const INODE_KEY = "inode:opencode";

const SOURCE_VERSION_DEFAULT = "1.2.x";

interface Identity {
  tenantId: string;
  engineerId: string;
  deviceId: string;
}

/**
 * OpenCode adapter — post-v1.2 SQLite only.
 *
 * Pre-v1.2 sharded JSON sessions (orphaned by the `opencode/issues/13654`
 * migration bug) are skipped with a warn log per session and a counter entry
 * exposed on `health().caveats`. Per CLAUDE.md §Adapter Matrix the fidelity
 * tag is `post-migration` so the dashboard shows the honest chip.
 */
export class OpenCodeAdapter implements Adapter {
  readonly id = "opencode";
  readonly label = "OpenCode";
  readonly version = "0.1.0";
  readonly supportedSourceVersions = ">=1.2.0";

  private sources: DiscoverySources | null = null;
  private readonly skipped = new SkippedCounter();

  constructor(private readonly identity: Identity) {}

  async init(ctx: AdapterContext): Promise<void> {
    this.sources = discoverSources();
    ctx.log.info("opencode adapter init", {
      sqliteExists: this.sources.sqliteExists,
      legacyDirExists: this.sources.legacyDirExists,
      dataDir: this.sources.dataDir,
    });
  }

  async poll(ctx: AdapterContext, signal: AbortSignal, emit: EventEmitter): Promise<void> {
    const s = this.sources ?? discoverSources();
    this.recordSkippedLegacy(s, ctx);
    if (!s.sqliteExists) return;
    if (signal.aborted) return;

    // Rotation / wipe detection (Bug #9): if the SQLite file's inode has
    // changed since the last tick, the DB was replaced (fresh install, blown
    // away + restored, etc.). Reset the watermark so we do a clean full
    // re-scan rather than continuing off a stale cursor from the previous
    // file's timeline.
    const currentInode = safeInode(s.sqlitePath);
    const prevInode = await ctx.cursor.get(INODE_KEY);
    let watermark = await ctx.cursor.get(WATERMARK_KEY);
    if (prevInode !== null && currentInode !== null && prevInode !== currentInode) {
      ctx.log.warn("opencode: sqlite rotated, resetting watermark", {
        path: s.sqlitePath,
        prevInode,
        currentInode,
      });
      watermark = null;
    }

    const { payloads, nextWatermark } = readSessionsSince(s.sqlitePath, watermark);

    // Emit per-session — stream events through the journal instead of
    // holding them in memory until all payloads are normalized.
    for (const payload of payloads) {
      if (signal.aborted) return;
      const events = normalizeSession(
        payload,
        { ...this.identity, tier: ctx.tier },
        SOURCE_VERSION_DEFAULT,
      );
      for (const e of events) emit(e);
    }

    // Advance cursors only after every session's events have been emitted.
    // A kill between emits is safe: the journal has the partial work, and
    // the next poll re-reads from `watermark` (which hasn't advanced yet)
    // — deduplication collapses the replay.
    if (nextWatermark !== null) {
      await ctx.cursor.set(WATERMARK_KEY, nextWatermark);
    }
    if (currentInode !== null && currentInode !== prevInode) {
      await ctx.cursor.set(INODE_KEY, currentInode);
    }
  }

  async health(_ctx: AdapterContext): Promise<AdapterHealth> {
    const s = this.sources ?? discoverSources();
    const caveats: string[] = [];
    if (!s.dataDirExists) {
      caveats.push("OpenCode data dir not found — adapter disabled.");
    }
    if (s.legacyDirExists && !s.sqliteExists) {
      caveats.push(
        "Pre-v1.2 sharded JSON detected; migrate to post-v1.2 SQLite to capture sessions.",
      );
    }
    if (this.skipped.getCount() > 0) {
      caveats.push(`${this.skipped.getCount()} pre-v1.2 session(s) skipped.`);
    }
    const status: AdapterHealth["status"] = s.sqliteExists
      ? "ok"
      : s.dataDirExists
        ? "degraded"
        : "disabled";
    return {
      status,
      fidelity: "post-migration",
      ...(caveats.length > 0 ? { caveats } : {}),
    };
  }

  /** Test-only: expose the skipped count for assertion. */
  getSkippedCount(): number {
    return this.skipped.getCount();
  }

  private recordSkippedLegacy(s: DiscoverySources, ctx: AdapterContext): void {
    if (!s.legacyDirExists) return;
    for (const sessionId of listLegacySessionIds(s.legacyDir)) {
      this.skipped.record(sessionId, "pre-v1.2 sharded JSON", ctx.log);
    }
  }
}

function safeInode(path: string): string | null {
  try {
    return String(statSync(path).ino);
  } catch {
    return null;
  }
}
