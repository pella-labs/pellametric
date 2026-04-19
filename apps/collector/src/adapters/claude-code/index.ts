import { statSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { Event } from "@bematist/schema";
import type { Adapter, AdapterContext, AdapterHealth } from "@bematist/sdk";
import { type DiscoverySources, discoverSources } from "./discovery";
import { normalizeSession } from "./normalize";
import { parseSessionFile } from "./parsers/parseSessionFile";

const SOURCE_VERSION_DEFAULT = "1.0.x";

interface Identity {
  tenantId: string;
  engineerId: string;
  deviceId: string;
}

export class ClaudeCodeAdapter implements Adapter {
  readonly id = "claude-code";
  readonly label = "Claude Code";
  readonly version = "0.1.0";
  readonly supportedSourceVersions = ">=1.0.0";

  private sources: DiscoverySources | null = null;

  constructor(private readonly identity: Identity) {}

  async init(ctx: AdapterContext): Promise<void> {
    this.sources = discoverSources();
    ctx.log.info("claude-code adapter init", {
      otelEnabled: this.sources.otelEnabled,
      jsonlDirExists: this.sources.jsonlDirExists,
    });
  }

  async poll(ctx: AdapterContext, _signal: AbortSignal): Promise<Event[]> {
    const s = this.sources ?? discoverSources();
    if (!s.jsonlDirExists) return [];

    const files = await findSessionFiles(s.jsonlDir);
    const out: Event[] = [];
    for (const path of files) {
      // Two-stage dedup:
      //
      // 1. Signature skip — if (size, mtime) hasn't changed since last
      //    poll, the file is untouched; don't even open it. This handles
      //    the 99% of historical JSONL files that never change.
      //
      // 2. Max-seq filter — when a file HAS grown (active session), we
      //    still have to re-parse the whole thing (normalizeSession's
      //    event_seq is a position-index, we can't parse just new lines
      //    and get the same seq numbering). But we only emit events whose
      //    seq exceeds the last-emitted max. Since Claude Code JSONL is
      //    append-only, new lines → new events at higher seq indices;
      //    everything ≤ prevMax has already been shipped.
      //
      // Before both stages landed, the M4 rehearsal saw 3× MV drift for
      // actively-coding teammates — every poll re-emitted every event in
      // every growing session file. deterministicId + Redis SETNX caught
      // most duplicates, but enough leaked through to double-count
      // `sumState(cost_usd)` in `dev_daily_rollup` before
      // ReplacingMergeTree collapsed the raw rows.
      const signatureKey = `signature:${path}`;
      let sigNow: string;
      try {
        const stat = statSync(path);
        sigNow = `${stat.size}:${stat.mtimeMs}`;
      } catch {
        // File disappeared between the walk and the stat — skip it.
        continue;
      }
      const sigPrev = await ctx.cursor.get(signatureKey);
      if (sigPrev === sigNow) continue;

      const maxSeqKey = `max_seq:${path}`;
      const prevMaxStr = await ctx.cursor.get(maxSeqKey);
      const prevMax = prevMaxStr === null ? -1 : Number.parseInt(prevMaxStr, 10);

      const parsed = await parseSessionFile(path);
      const events = normalizeSession(
        parsed,
        { ...this.identity, tier: ctx.tier },
        SOURCE_VERSION_DEFAULT,
      );

      let newHighWatermark = prevMax;
      for (const e of events) {
        if (e.event_seq > prevMax) {
          out.push(e);
          if (e.event_seq > newHighWatermark) newHighWatermark = e.event_seq;
        }
      }

      if (newHighWatermark > prevMax) {
        await ctx.cursor.set(maxSeqKey, String(newHighWatermark));
      }
      await ctx.cursor.set(signatureKey, sigNow);
    }
    return out;
  }

  async health(_ctx: AdapterContext): Promise<AdapterHealth> {
    const s = this.sources ?? discoverSources();
    const caveats: string[] = [];
    if (!s.otelEnabled && !s.jsonlDirExists) {
      caveats.push("No OTel env var and no JSONL dir — no Claude Code data will be captured.");
    }
    if (!s.otelEnabled && s.jsonlDirExists) {
      caveats.push("JSONL-backfill mode: OTLP receiver lands in M2; JSONL is sufficient for M1.");
    }
    const status = s.otelEnabled || s.jsonlDirExists ? "ok" : "disabled";
    return {
      status,
      fidelity: "full",
      ...(caveats.length > 0 ? { caveats } : {}),
    };
  }
}

async function findSessionFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string) {
    let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>;
    try {
      entries = (await readdir(dir, { withFileTypes: true })) as unknown as Array<{
        name: string;
        isDirectory(): boolean;
        isFile(): boolean;
      }>;
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        // Skip `subagents/` subdirectories. Every Claude Code Task-tool
        // invocation writes a subagent JSONL with its own fresh sessionId;
        // walking into these directories inflates session counts drastically
        // (observed ratio ~1.6× subagent files per parent session on real
        // ~/.claude/projects/ installs). The subagent LLM turn *cost* is
        // tiny (~$0.02/session in the M4 rehearsal sample — ~1% of total),
        // and the parent session's tool_call events already attribute the
        // delegation, so skipping them here trades a rounding-error of cost
        // for a session count that matches "conversations a human would
        // recognize as distinct."
        if (e.name === "subagents") continue;
        await walk(p);
      } else if (e.isFile() && e.name.endsWith(".jsonl")) out.push(p);
    }
  }
  await walk(root);
  return out;
}
