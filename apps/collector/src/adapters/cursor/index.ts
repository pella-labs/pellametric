import type { Adapter, AdapterContext, AdapterHealth, EventEmitter } from "@bematist/sdk";
import { tryOpenReadOnlyCopy } from "./copyRead";
import { type DiscoverySources, discoverSources } from "./discovery";
import { normalizeGenerations } from "./normalize";
import { parseCursorState } from "./parse";

const SOURCE_VERSION_DEFAULT = "0.x";
const CURSOR_MAX_UNIX_KEY = "max_unix_ms";

interface Identity {
  tenantId: string;
  engineerId: string;
  deviceId: string;
}

export class CursorAdapter implements Adapter {
  readonly id = "cursor";
  readonly label = "Cursor";
  readonly version = "0.1.0";
  readonly supportedSourceVersions = ">=0.40.0";

  private sources: DiscoverySources | null = null;
  private lastAutoSeen = false;
  // When copy-and-read fails after all retries the adapter keeps emitting []
  // but `health()` must tell the operator. This caveat is cleared the next
  // time a poll succeeds.
  private lastCopyFailure: string | null = null;

  constructor(private readonly identity: Identity) {}

  async init(ctx: AdapterContext): Promise<void> {
    this.sources = discoverSources();
    ctx.log.info("cursor adapter init", {
      dbPath: this.sources.dbPath,
      dbExists: this.sources.dbExists,
    });
  }

  async poll(ctx: AdapterContext, signal: AbortSignal, emit: EventEmitter): Promise<void> {
    const s = this.sources ?? discoverSources();
    if (!s.dbExists) return;
    if (signal.aborted) return;

    const result = await tryOpenReadOnlyCopy(s.dbPath);
    if (!result.ok) {
      ctx.log.warn("cursor: copy-read failed after retries", {
        attempts: result.attempts,
        lastError: result.lastError,
        path: s.dbPath,
      });
      this.lastCopyFailure = result.lastError;
      return;
    }

    try {
      const { generations, warnings } = parseCursorState(result.db);
      for (const w of warnings) ctx.log.warn(w);

      const cursorMaxStr = await ctx.cursor.get(CURSOR_MAX_UNIX_KEY);
      const cursorMax = cursorMaxStr ? Number.parseInt(cursorMaxStr, 10) : 0;
      const fresh = generations.filter((g) => g.unixMs > cursorMax);

      const events = normalizeGenerations(
        fresh,
        { ...this.identity, tier: ctx.tier },
        SOURCE_VERSION_DEFAULT,
      );
      for (const e of events) emit(e);

      this.lastAutoSeen = fresh.some((g) => g.mode === "auto" || g.mode === undefined);

      // Cursor advance strictly AFTER emits.
      if (fresh.length > 0) {
        const newMax = Math.max(...fresh.map((g) => g.unixMs), cursorMax);
        await ctx.cursor.set(CURSOR_MAX_UNIX_KEY, String(newMax));
      }
      // Success — clear any stale copy-failure caveat.
      this.lastCopyFailure = null;
    } catch (e) {
      ctx.log.warn("cursor: parse failed", { err: errStr(e) });
    } finally {
      result.cleanup();
    }
  }

  async health(_ctx: AdapterContext): Promise<AdapterHealth> {
    const s = this.sources ?? discoverSources();
    const caveats: string[] = [];
    if (!s.dbExists) {
      return {
        status: "disabled",
        fidelity: "estimated",
        caveats: [`No Cursor state.vscdb at ${s.dbPath}`],
      };
    }
    if (this.lastAutoSeen) {
      caveats.push("Cursor Auto-mode events ship with cost_estimated=true");
    }
    if (this.lastCopyFailure) {
      caveats.push(`Last copy-read failed after retries: ${this.lastCopyFailure}`);
      return {
        status: "degraded",
        fidelity: this.lastAutoSeen ? "estimated" : "full",
        caveats,
        lastError: this.lastCopyFailure,
      };
    }
    return {
      status: "ok",
      fidelity: this.lastAutoSeen ? "estimated" : "full",
      ...(caveats.length > 0 ? { caveats } : {}),
    };
  }
}

function errStr(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
