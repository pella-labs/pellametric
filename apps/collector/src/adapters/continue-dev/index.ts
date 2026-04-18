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
  parseChatInteractionStream,
  parseEditOutcomeStream,
  parseTokensGeneratedStream,
  parseToolUsageStream,
} from "./parseStream";
import type { ContinueStreamName } from "./paths";

const SOURCE_VERSION_DEFAULT = "0.2.0";

interface Identity {
  tenantId: string;
  engineerId: string;
  deviceId: string;
}

/**
 * Continue.dev adapter (D23 — first OSS parser of Continue's 4 dev-data streams).
 *
 * Reads `~/.continue/dev_data/0.2.0/{chatInteraction,tokensGenerated,editOutcome,toolUsage}.jsonl`.
 * One adapter, four independent cursors — one per stream. Each cursor stores
 * the byte offset of the last consumed newline, so polls are resumable across
 * collector restarts and tolerate mid-line writes.
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
    const out: Event[] = [];

    out.push(...(await this.pollChatInteraction(ctx, s, identity)));
    out.push(...(await this.pollTokensGenerated(ctx, s, identity)));
    out.push(...(await this.pollEditOutcome(ctx, s, identity)));
    out.push(...(await this.pollToolUsage(ctx, s, identity)));

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

  private async readCursor(ctx: AdapterContext, stream: ContinueStreamName): Promise<number> {
    const raw = await ctx.cursor.get(cursorKey(stream));
    if (!raw) return 0;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }

  private async writeCursor(
    ctx: AdapterContext,
    stream: ContinueStreamName,
    offset: number,
  ): Promise<void> {
    await ctx.cursor.set(cursorKey(stream), String(offset));
  }

  private async pollChatInteraction(
    ctx: AdapterContext,
    s: ContinueDiscovery,
    identity: { tenantId: string; engineerId: string; deviceId: string; tier: "A" | "B" | "C" },
  ): Promise<Event[]> {
    const spec = s.streams.chatInteraction;
    if (!spec.exists) return [];
    const offset = await this.readCursor(ctx, "chatInteraction");
    const parsed = await parseChatInteractionStream(spec.path, offset);
    const events = normalizeChatInteraction(parsed.lines, identity, SOURCE_VERSION_DEFAULT);
    await this.writeCursor(ctx, "chatInteraction", parsed.nextOffset);
    return events;
  }

  private async pollTokensGenerated(
    ctx: AdapterContext,
    s: ContinueDiscovery,
    identity: { tenantId: string; engineerId: string; deviceId: string; tier: "A" | "B" | "C" },
  ): Promise<Event[]> {
    const spec = s.streams.tokensGenerated;
    if (!spec.exists) return [];
    const offset = await this.readCursor(ctx, "tokensGenerated");
    const parsed = await parseTokensGeneratedStream(spec.path, offset);
    const events = normalizeTokensGenerated(parsed.lines, identity, SOURCE_VERSION_DEFAULT);
    await this.writeCursor(ctx, "tokensGenerated", parsed.nextOffset);
    return events;
  }

  private async pollEditOutcome(
    ctx: AdapterContext,
    s: ContinueDiscovery,
    identity: { tenantId: string; engineerId: string; deviceId: string; tier: "A" | "B" | "C" },
  ): Promise<Event[]> {
    const spec = s.streams.editOutcome;
    if (!spec.exists) return [];
    const offset = await this.readCursor(ctx, "editOutcome");
    const parsed = await parseEditOutcomeStream(spec.path, offset);
    const events = normalizeEditOutcome(parsed.lines, identity, SOURCE_VERSION_DEFAULT);
    await this.writeCursor(ctx, "editOutcome", parsed.nextOffset);
    return events;
  }

  private async pollToolUsage(
    ctx: AdapterContext,
    s: ContinueDiscovery,
    identity: { tenantId: string; engineerId: string; deviceId: string; tier: "A" | "B" | "C" },
  ): Promise<Event[]> {
    const spec = s.streams.toolUsage;
    if (!spec.exists) return [];
    const offset = await this.readCursor(ctx, "toolUsage");
    const parsed = await parseToolUsageStream(spec.path, offset);
    const events = normalizeToolUsage(parsed.lines, identity, SOURCE_VERSION_DEFAULT);
    await this.writeCursor(ctx, "toolUsage", parsed.nextOffset);
    return events;
  }
}

export function cursorKey(stream: ContinueStreamName): string {
  return `offset:continue:${stream}`;
}
