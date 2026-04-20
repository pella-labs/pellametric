import { statSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Adapter, AdapterContext, AdapterHealth, EventEmitter } from "@bematist/sdk";
import { type CodexDiscoverySources, discoverSources } from "./discovery";
import { normalizeSession } from "./normalize";
import {
  type CodexUsageSnapshot,
  findLastCumulative,
  parseLines,
  parseSessionFile,
  ZERO_SNAPSHOT,
} from "./parsers/parseSessionFile";
import { readLinesFromOffset } from "./parsers/safeRead";

const SOURCE_VERSION_DEFAULT = "0.1.x";

interface Identity {
  tenantId: string;
  engineerId: string;
  deviceId: string;
}

export class CodexAdapter implements Adapter {
  readonly id = "codex";
  readonly label = "Codex CLI";
  readonly version = "0.1.0";
  readonly supportedSourceVersions = ">=0.1.0";

  private sources: CodexDiscoverySources | null = null;

  constructor(private readonly identity: Identity) {}

  async init(ctx: AdapterContext): Promise<void> {
    this.sources = discoverSources();
    ctx.log.info("codex adapter init", {
      sessionsDir: this.sources.sessionsDir,
      sessionsDirExists: this.sources.sessionsDirExists,
    });
  }

  async poll(ctx: AdapterContext, signal: AbortSignal, emit: EventEmitter): Promise<void> {
    const s = this.sources ?? discoverSources();
    if (!s.sessionsDirExists) return;

    const files = await findRolloutFiles(s.sessionsDir);
    for (const path of files) {
      // Honor the abort signal — the orchestrator's hard-kill watchdog
      // expects every adapter to bail promptly. Events already emitted
      // are durable in the journal; cursor writes we've already done
      // mark progress; the next tick picks up where we stopped.
      if (signal.aborted) {
        ctx.log.info("codex: poll aborted mid-scan — returning early");
        return;
      }
      const offsetKey = `offset:${path}`;
      const cumulativeKey = `cumulative:${path}`;
      const branchKey = `branch:${path}`;
      const inodeKey = `inode:${path}`;
      let prevOffset = Number.parseInt((await ctx.cursor.get(offsetKey)) ?? "0", 10);
      let priorCumulative = parseCumulative(await ctx.cursor.get(cumulativeKey));
      let branch: string | undefined = (await ctx.cursor.get(branchKey)) ?? undefined;
      const prevInode = (await ctx.cursor.get(inodeKey)) ?? null;

      // Rotation / truncation detection (bug #2). Compare the file's current
      // (size, inode) against the last cursor state. If size < prevOffset the
      // file was truncated or replaced with a smaller one; if the inode
      // changed, the file was rotated (rm + recreate keeps the path but
      // changes the inode). In either case, reset to first-run: re-parse the
      // whole file, derive a fresh cumulative, and overwrite the stale cursor
      // rows.
      let currentInode: string | null = null;
      try {
        const stat = statSync(path);
        currentInode = String(stat.ino);
        const rotatedBySize = prevOffset > 0 && stat.size < prevOffset;
        const rotatedByInode = prevInode !== null && prevInode !== currentInode;
        if (rotatedBySize || rotatedByInode) {
          ctx.log.warn("codex: rollout rotated/truncated, resetting offset", {
            path,
            prevOffset,
            size: stat.size,
            prevInode,
            currentInode,
            reason: rotatedBySize ? "size<offset" : "inode-change",
          });
          prevOffset = 0;
          priorCumulative = null;
          // Cursor rows get overwritten below by the first-run branch — no
          // explicit delete needed (CursorStore has no delete surface).
        }
      } catch {
        // stat failed — file gone or inaccessible. Skip this file this tick;
        // if/when it reappears we'll see a fresh inode and reset cleanly.
        continue;
      }

      // Cursor-wipe recovery (bug #1). If we have a non-zero offset but no
      // cumulative, the cursor DB was wiped/corrupted between polls. Re-derive
      // priorCumulative by scanning the already-emitted prefix (capped at
      // prevOffset) so the next delta is computed against the true last-known
      // cumulative — never the newest cumulative in the file (which would
      // silently swallow the next turn's delta as zero).
      if (prevOffset > 0 && priorCumulative === null) {
        const recovered = await findLastCumulative(path, 262_144, prevOffset);
        if (recovered) {
          priorCumulative = recovered;
          ctx.log.warn("codex: cursor cumulative missing, recovered from rollout tail", {
            path,
            prevOffset,
          });
        } else {
          ctx.log.warn("codex: cursor cumulative missing and no tail snapshot found", {
            path,
            prevOffset,
          });
        }
      }

      if (prevOffset === 0) {
        const parsed = await parseSessionFile(path, { priorCumulative });
        // Resolve git branch from session_meta.gitBranch (future Codex) OR the
        // `cwd` repo's current HEAD. Cached per rollout so later polls skip it.
        if (!branch) {
          branch = await resolveBranch(parsed.sessionMeta?.gitBranch, parsed.sessionMeta?.cwd);
          if (branch) await ctx.cursor.set(branchKey, branch);
        }
        const firstRunEvents = normalizeSession(
          parsed,
          { ...this.identity, tier: ctx.tier },
          SOURCE_VERSION_DEFAULT,
          branch ? { branch } : {},
        );
        for (const e of firstRunEvents) emit(e);
        const { nextOffset } = await readLinesFromOffset(path, 0);
        // Cursor writes after emits so durability ≥ cursor-advance.
        await ctx.cursor.set(offsetKey, String(nextOffset));
        if (parsed.lastCumulative) {
          await ctx.cursor.set(cumulativeKey, JSON.stringify(parsed.lastCumulative));
        }
        if (currentInode !== null) await ctx.cursor.set(inodeKey, currentInode);
        continue;
      }

      const { lines, nextOffset } = await readLinesFromOffset(path, prevOffset);
      if (lines.length === 0) {
        // Still pin the inode — a later poll can detect rotation even if
        // nothing new has been appended yet.
        if (currentInode !== null && prevInode !== currentInode) {
          await ctx.cursor.set(inodeKey, currentInode);
        }
        continue;
      }
      const parsed = parseLines(lines, { priorCumulative });
      parsed.sessionId = parsed.sessionId ?? sessionIdFromPath(path);
      const deltaEvents = normalizeSession(
        parsed,
        { ...this.identity, tier: ctx.tier },
        SOURCE_VERSION_DEFAULT,
        branch ? { branch } : {},
      );
      for (const e of deltaEvents) emit(e);
      await ctx.cursor.set(offsetKey, String(nextOffset));
      if (parsed.lastCumulative) {
        await ctx.cursor.set(cumulativeKey, JSON.stringify(parsed.lastCumulative));
      }
      if (currentInode !== null) await ctx.cursor.set(inodeKey, currentInode);
    }
  }

  async health(_ctx: AdapterContext): Promise<AdapterHealth> {
    const s = this.sources ?? discoverSources();
    const caveats: string[] = [];
    if (!s.sessionsDirExists) {
      caveats.push("No ~/.codex/sessions directory — no Codex data will be captured.");
    } else {
      caveats.push(
        "Per-turn tokens derived by diffing cumulative token_count; cursor wipes self-heal by re-deriving from the rollout tail.",
      );
    }
    const status = s.sessionsDirExists ? "ok" : "disabled";
    return {
      status,
      fidelity: "full",
      caveats,
    };
  }
}

function parseCumulative(raw: string | null): CodexUsageSnapshot | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<CodexUsageSnapshot>;
    return {
      input_tokens: parsed.input_tokens ?? 0,
      output_tokens: parsed.output_tokens ?? 0,
      cached_input_tokens: parsed.cached_input_tokens ?? 0,
      total_tokens: parsed.total_tokens ?? 0,
    };
  } catch {
    return null;
  }
}

function sessionIdFromPath(path: string): string {
  const name = path.split("/").pop() ?? path;
  const m = name.match(/^rollout-([A-Za-z0-9_-]+)\.jsonl$/);
  if (m?.[1]) return m[1];
  return name.replace(/\.jsonl$/, "");
}

async function findRolloutFiles(root: string): Promise<string[]> {
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
      else if (e.isFile() && e.name.startsWith("rollout-") && e.name.endsWith(".jsonl")) {
        out.push(p);
      }
    }
  }
  await walk(root);
  return out;
}

/**
 * Resolve the active git branch for a Codex session.
 *
 * Priority:
 *   1. `sessionMeta.gitBranch` if Codex ever starts emitting it (reserved).
 *   2. Read `<cwd>/.git/HEAD` and parse `ref: refs/heads/<name>`.
 *
 * Returns undefined on any failure — non-fatal, branch is a join-key nicety
 * (denormalized outcome attribution), not a required field.
 *
 * Exported for tests.
 */
export async function resolveBranch(
  gitBranch: string | undefined,
  cwd: string | undefined,
): Promise<string | undefined> {
  if (gitBranch && typeof gitBranch === "string" && gitBranch.length > 0) return gitBranch;
  if (!cwd) return undefined;
  try {
    const head = await readFile(join(cwd, ".git", "HEAD"), "utf8");
    const m = head.match(/^ref:\s*refs\/heads\/(.+?)\s*$/m);
    if (m?.[1]) return m[1];
    // Detached HEAD — first 12 chars of the sha.
    const sha = head.trim();
    if (/^[0-9a-f]{7,40}$/i.test(sha)) return `detached-${sha.substring(0, 12)}`;
  } catch {
    // Missing .git or not a repo — return undefined; non-fatal.
  }
  return undefined;
}

export { ZERO_SNAPSHOT };
