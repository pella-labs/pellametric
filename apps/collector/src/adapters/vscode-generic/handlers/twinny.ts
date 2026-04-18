import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Event } from "@bematist/schema";
import type { VSCodeExtensionContext, VSCodeExtensionHandler } from "@bematist/sdk";
import type { ServerIdentity } from "../normalize";
import { baseEvent, deterministicEventId } from "../normalize";

/**
 * Example handler for the Twinny VS Code extension (rjmacarthy.twinny) — an
 * open-source local-LLM coding assistant. Picked as the A5 example because:
 *
 *   1. It is a real, published VS Code extension that exercises the seam.
 *   2. It is NOT in the Phase-2 full-adapter list (Cline/Roo/Kilo, Copilot
 *      IDE), so the generic SDK stays the right home for it.
 *   3. It runs against local LLMs, so `fidelity='estimated'` with no cost is
 *      the honest answer — a useful demonstration of how handlers declare
 *      their data caveats.
 *
 * Storage shape (expected from the extension's chat-history export; v1 of
 * this handler reads the minimal JSONL shape documented in our golden
 * fixture — future extension-native schemas are additive, versioned through
 * `source_version`):
 *
 *   <User>/globalStorage/rjmacarthy.twinny/telemetry.jsonl
 *
 *   { "type": "session_start", "sessionId": "...", "timestamp": "..." }
 *   { "type": "chat_response", "sessionId": "...", "timestamp": "...",
 *     "model": "codellama:7b", "inputTokens": N, "outputTokens": N }
 *   { "type": "session_end", "sessionId": "...", "timestamp": "..." }
 *
 * Any other line types are skipped with a debug log (community authors can
 * extend the switch without forking the base adapter).
 */

const EXTENSION_ID = "rjmacarthy.twinny";

interface TwinnyLine {
  type?: string;
  sessionId?: string;
  timestamp?: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
}

export function makeTwinnyHandler(identity: ServerIdentity): VSCodeExtensionHandler {
  return {
    extensionId: EXTENSION_ID,
    label: "Twinny (VS Code)",
    fidelity: "estimated",
    version: "0.1.0",
    caveats: [
      "Local-LLM extension: cost_estimated=true; no cost_usd emitted.",
      "Aggregate-level token counts only — no per-prompt envelope.",
    ],

    async discover(ctx: VSCodeExtensionContext): Promise<string[]> {
      const path = join(ctx.userDir, "globalStorage", EXTENSION_ID, "telemetry.jsonl");
      return existsSync(path) ? [path] : [];
    },

    async parse(
      ctx: VSCodeExtensionContext,
      filePath: string,
      signal: AbortSignal,
    ): Promise<Event[]> {
      if (signal.aborted) return [];
      let raw: string;
      try {
        raw = await readFile(filePath, "utf8");
      } catch (e) {
        ctx.log.warn("twinny: cannot read telemetry file", { filePath, err: String(e) });
        return [];
      }
      const cursorKey = `${EXTENSION_ID}:offset:${filePath}`;
      const prevStr = await ctx.cursor.get(cursorKey);
      const prevOffset = prevStr ? Number.parseInt(prevStr, 10) : 0;
      if (Number.isNaN(prevOffset) || prevOffset < 0 || prevOffset > raw.length) {
        ctx.log.warn("twinny: cursor offset out of range; resetting", { cursorKey, prevOffset });
      }
      const safeOffset =
        Number.isFinite(prevOffset) && prevOffset >= 0 && prevOffset <= raw.length ? prevOffset : 0;

      const tail = raw.slice(safeOffset);
      const lines = tail.split("\n").filter((l) => l.trim().length > 0);

      let seq = 0;
      const out: Event[] = [];
      for (const line of lines) {
        if (signal.aborted) return out;
        let parsed: TwinnyLine;
        try {
          parsed = JSON.parse(line) as TwinnyLine;
        } catch (e) {
          ctx.log.warn("twinny: skipping malformed JSONL line", { err: String(e) });
          continue;
        }
        const sessionId = parsed.sessionId ?? "unknown";
        const ts = parsed.timestamp ?? new Date().toISOString();
        const envelope = baseEvent({
          id: identity,
          sessionId,
          seq,
          ts,
          fidelity: "estimated",
          costEstimated: true,
          sourceVersion: "twinny@v1",
        });
        if (parsed.type === "session_start") {
          out.push({
            ...envelope,
            client_event_id: deterministicEventId(
              EXTENSION_ID,
              sessionId,
              seq,
              "session_start",
              parsed,
            ),
            dev_metrics: { event_kind: "session_start", duration_ms: 0 },
          } as Event);
          seq++;
          continue;
        }
        if (parsed.type === "session_end") {
          out.push({
            ...envelope,
            client_event_id: deterministicEventId(
              EXTENSION_ID,
              sessionId,
              seq,
              "session_end",
              parsed,
            ),
            dev_metrics: { event_kind: "session_end" },
          } as Event);
          seq++;
          continue;
        }
        if (parsed.type === "chat_response") {
          const response = parsed.model !== undefined ? { model: parsed.model } : undefined;
          const usage: Record<string, number> = {};
          if (typeof parsed.inputTokens === "number") usage.input_tokens = parsed.inputTokens;
          if (typeof parsed.outputTokens === "number") usage.output_tokens = parsed.outputTokens;
          const genAi: Event["gen_ai"] = {};
          if (response) genAi.response = response;
          if (Object.keys(usage).length > 0) genAi.usage = usage;
          out.push({
            ...envelope,
            client_event_id: deterministicEventId(
              EXTENSION_ID,
              sessionId,
              seq,
              "llm_response",
              parsed,
            ),
            gen_ai: genAi,
            dev_metrics: { event_kind: "llm_response" },
          } as Event);
          seq++;
          continue;
        }
        ctx.log.debug("twinny: unknown line type; skipping", { type: parsed.type });
      }

      await ctx.cursor.set(cursorKey, String(raw.length));
      return out;
    },
  };
}
