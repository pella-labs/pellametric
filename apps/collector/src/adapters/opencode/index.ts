import type { Event } from "@bematist/schema";
import type { Adapter, AdapterContext, AdapterHealth } from "@bematist/sdk";
import { type DiscoverySources, discoverSources } from "./discovery";
import { normalizeSession } from "./normalize";
import { listLegacySessionIds, SkippedCounter } from "./skipped";
import { readAllSessions } from "./sqlite";

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

  async poll(ctx: AdapterContext, _signal: AbortSignal): Promise<Event[]> {
    const s = this.sources ?? discoverSources();
    this.recordSkippedLegacy(s, ctx);
    if (!s.sqliteExists) return [];

    const payloads = readAllSessions(s.sqlitePath);
    const out: Event[] = [];
    for (const payload of payloads) {
      const events = normalizeSession(
        payload,
        { ...this.identity, tier: ctx.tier },
        SOURCE_VERSION_DEFAULT,
      );
      out.push(...events);
    }
    return out;
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
