import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { Event } from "@bematist/schema";
import type { Adapter, AdapterContext, AdapterHealth } from "@bematist/sdk";
import { type CodexDiscoverySources, discoverSources } from "./discovery";
import { normalizeSession } from "./normalize";
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
      const prevOffset = Number.parseInt((await ctx.cursor.get(offsetKey)) ?? "0", 10);
      const priorCumulative = parseCumulative(await ctx.cursor.get(cumulativeKey));

      if (prevOffset === 0) {
        const parsed = await parseSessionFile(path, { priorCumulative });
        out.push(
          ...normalizeSession(parsed, { ...this.identity, tier: ctx.tier }, SOURCE_VERSION_DEFAULT),
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
      out.push(
        ...normalizeSession(parsed, { ...this.identity, tier: ctx.tier }, SOURCE_VERSION_DEFAULT),
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

export { ZERO_SNAPSHOT };
