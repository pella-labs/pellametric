import { statSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { Event } from "@bematist/schema";
import type { Adapter, AdapterContext, AdapterHealth } from "@bematist/sdk";
import { resolveGitContext } from "../../lib/git-context";
import { type DiscoverySources, discoverSources } from "./discovery";
import { type NormalizeExtras, normalizeSession } from "./normalize";
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

  async poll(ctx: AdapterContext, signal: AbortSignal): Promise<Event[]> {
    const s = this.sources ?? discoverSources();
    if (!s.jsonlDirExists) return [];

    const files = await findSessionFiles(s.jsonlDir);
    const out: Event[] = [];
    for (const path of files) {
      // Early-exit on abort so the orchestrator's timeout doesn't cause us
      // to keep parsing + updating cursors past the deadline. Returning
      // what we've emitted so far lets the next poll pick up from exactly
      // where this one left off (signature cache does the rest).
      if (signal.aborted) {
        const remaining = files.length - files.indexOf(path);
        ctx.log.info(
          `claude-code: poll aborted mid-scan — emitted ${out.length}, ${remaining} files unprocessed`,
        );
        break;
      }
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

      // Resolve commit_sha once per session — cached in ctx.cursor keyed by
      // session_id so long-running sessions don't spawn `git rev-parse` on
      // every poll. `cwd` comes from the first line that carries it
      // (~/.claude/projects/**.jsonl stamps cwd on user/assistant messages).
      const sessionId = parsed.sessionId ?? `file:${path}`;
      const commitShaKey = `commit_sha:${sessionId}`;
      let commit_sha: string | undefined = (await ctx.cursor.get(commitShaKey)) ?? undefined;
      if (!commit_sha) {
        const cwd = parsed.entries.find((l) => typeof l.cwd === "string" && l.cwd)?.cwd;
        if (cwd) {
          const git = await resolveGitContext(cwd);
          if (git.head_sha) {
            commit_sha = git.head_sha;
            await ctx.cursor.set(commitShaKey, commit_sha);
          }
        }
      }
      const extras: NormalizeExtras = {};
      if (commit_sha) extras.commit_sha = commit_sha;

      const events = normalizeSession(
        parsed,
        { ...this.identity, tier: ctx.tier },
        SOURCE_VERSION_DEFAULT,
        extras,
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
  // Walks the full tree, including `subagents/` subdirectories. Claude Code
  // writes one JSONL per Task-tool invocation under
  // `<project>/<sessionId>/subagents/agent-<agentId>.jsonl`, but crucially
  // the `sessionId` field inside every line of those files is the PARENT
  // conversation's sessionId — not a fresh one. normalizeSession pulls
  // session_id from the JSONL content, so subagent events flow into the
  // parent's session_id automatically. That means:
  //
  //   - Token usage and cost from subagent LLM turns are correctly
  //     attributed to the originating conversation (what we want — those
  //     are real tokens the dev spent).
  //   - Subagent files do NOT inflate `countDistinct(session_id)` because
  //     they share the parent's sessionId.
  //
  // An earlier iteration (57e8c02) skipped `subagents/` on the mistaken
  // theory that subagents had fresh sessionIds and were inflating counts.
  // Reverted — we want the cost data.
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
      if (e.isDirectory()) await walk(p);
      else if (e.isFile() && e.name.endsWith(".jsonl")) out.push(p);
    }
  }
  await walk(root);
  return out;
}
