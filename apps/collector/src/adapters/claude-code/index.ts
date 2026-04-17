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
      const offsetKey = `offset:${path}`;
      const prevStr = await ctx.cursor.get(offsetKey);
      const prev = prevStr ? Number.parseInt(prevStr, 10) : 0;
      const parsed = await parseSessionFile(path);
      const events = normalizeSession(
        parsed,
        { ...this.identity, tier: ctx.tier },
        SOURCE_VERSION_DEFAULT,
      );
      out.push(...events);
      await ctx.cursor.set(offsetKey, String(prev));
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
      if (e.isDirectory()) await walk(p);
      else if (e.isFile() && e.name.endsWith(".jsonl")) out.push(p);
    }
  }
  await walk(root);
  return out;
}
