import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Event } from "@bematist/schema";
import type { Adapter, AdapterContext, AdapterHealth } from "@bematist/sdk";
import { resolveGitContext } from "../../lib/git-context";
import { type CodexDiscoverySources, discoverSources } from "./discovery";
import { type NormalizeExtras, normalizeSession } from "./normalize";
import {
  type CodexUsageSnapshot,
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

  async poll(ctx: AdapterContext, _signal: AbortSignal): Promise<Event[]> {
    const s = this.sources ?? discoverSources();
    if (!s.sessionsDirExists) return [];

    const files = await findRolloutFiles(s.sessionsDir);
    const out: Event[] = [];
    for (const path of files) {
      const offsetKey = `offset:${path}`;
      const cumulativeKey = `cumulative:${path}`;
      const branchKey = `branch:${path}`;
      const commitShaKey = `commit_sha:${path}`;
      const prevOffset = Number.parseInt((await ctx.cursor.get(offsetKey)) ?? "0", 10);
      const priorCumulative = parseCumulative(await ctx.cursor.get(cumulativeKey));
      let branch: string | undefined = (await ctx.cursor.get(branchKey)) ?? undefined;
      let commit_sha: string | undefined = (await ctx.cursor.get(commitShaKey)) ?? undefined;

      if (prevOffset === 0) {
        const parsed = await parseSessionFile(path, { priorCumulative });
        const cwd = parsed.sessionMeta?.cwd;
        // Resolve git branch from session_meta.gitBranch (future Codex) OR the
        // `cwd` repo's current HEAD. Cached per rollout so later polls skip it.
        if (!branch) {
          branch = await resolveBranch(parsed.sessionMeta?.gitBranch, cwd);
          if (branch) await ctx.cursor.set(branchKey, branch);
        }
        // Resolve commit_sha once per rollout file — spawning `git rev-parse
        // HEAD` is only acceptable if we amortize it across the lifetime of
        // the session. `cwd` may be undefined on older Codex rollouts; fall
        // back to process.cwd() when capturing live. Documented fidelity loss.
        if (!commit_sha) {
          const ctxCwd = cwd ?? process.cwd();
          const git = await resolveGitContext(ctxCwd);
          if (git.head_sha) {
            commit_sha = git.head_sha;
            await ctx.cursor.set(commitShaKey, commit_sha);
          }
        }
        const extras: NormalizeExtras = {};
        if (branch) extras.branch = branch;
        if (commit_sha) extras.commit_sha = commit_sha;
        out.push(
          ...normalizeSession(
            parsed,
            { ...this.identity, tier: ctx.tier },
            SOURCE_VERSION_DEFAULT,
            extras,
          ),
        );
        const { nextOffset } = await readLinesFromOffset(path, 0);
        await ctx.cursor.set(offsetKey, String(nextOffset));
        if (parsed.lastCumulative) {
          await ctx.cursor.set(cumulativeKey, JSON.stringify(parsed.lastCumulative));
        }
        continue;
      }

      const { lines, nextOffset } = await readLinesFromOffset(path, prevOffset);
      if (lines.length === 0) continue;
      const parsed = parseLines(lines, { priorCumulative });
      parsed.sessionId = parsed.sessionId ?? sessionIdFromPath(path);
      const extras: NormalizeExtras = {};
      if (branch) extras.branch = branch;
      if (commit_sha) extras.commit_sha = commit_sha;
      out.push(
        ...normalizeSession(
          parsed,
          { ...this.identity, tier: ctx.tier },
          SOURCE_VERSION_DEFAULT,
          extras,
        ),
      );
      await ctx.cursor.set(offsetKey, String(nextOffset));
      if (parsed.lastCumulative) {
        await ctx.cursor.set(cumulativeKey, JSON.stringify(parsed.lastCumulative));
      }
    }
    return out;
  }

  async health(_ctx: AdapterContext): Promise<AdapterHealth> {
    const s = this.sources ?? discoverSources();
    const caveats: string[] = [];
    if (!s.sessionsDirExists) {
      caveats.push("No ~/.codex/sessions directory — no Codex data will be captured.");
    } else {
      caveats.push(
        "Per-turn tokens derived by diffing cumulative token_count; collector restart mid-session can lose the prior cumulative if the egress journal was wiped.",
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
