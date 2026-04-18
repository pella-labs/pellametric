import type { Database } from "bun:sqlite";

export interface CursorGenerationRow {
  unixMs: number;
  generationUUID: string;
  conversationId?: string;
  textDescription?: string;
  type?: string;
  model?: string;
  mode?: "auto" | "pro" | string;
  tokenCount?: {
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  };
  toolFormerData?: {
    tool?: string;
    additionalData?: { status?: string };
  };
}

export interface ParsedCursorState {
  generations: CursorGenerationRow[];
  warnings: string[];
}

/**
 * Extract Cursor AI generations from a read-only state.vscdb. Tolerant to
 * missing tables / keys / malformed JSON — returns an empty list with a
 * warning instead of throwing (contract 03 invariant: poll never crashes
 * the collector).
 */
export function parseCursorState(db: Database): ParsedCursorState {
  const warnings: string[] = [];
  const generations: CursorGenerationRow[] = [];

  let hasItemTable = false;
  try {
    hasItemTable =
      db
        .query<{ name: string }, []>(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='ItemTable'",
        )
        .get() !== null;
  } catch (e) {
    warnings.push(`cursor: cannot read sqlite_master (${errStr(e)})`);
    return { generations, warnings };
  }
  if (!hasItemTable) {
    warnings.push("cursor: ItemTable not found — unexpected Cursor schema");
    return { generations, warnings };
  }

  let raw: string | null = null;
  try {
    const row = db
      .query<{ value: string | Buffer }, [string]>("SELECT value FROM ItemTable WHERE key = ?")
      .get("aiService.generations");
    if (row) raw = typeof row.value === "string" ? row.value : row.value.toString("utf8");
  } catch (e) {
    warnings.push(`cursor: ItemTable read failed (${errStr(e)})`);
    return { generations, warnings };
  }

  if (!raw) {
    warnings.push("cursor: no aiService.generations key present");
    return { generations, warnings };
  }

  let arr: unknown;
  try {
    arr = JSON.parse(raw);
  } catch (e) {
    warnings.push(`cursor: aiService.generations is not valid JSON (${errStr(e)})`);
    return { generations, warnings };
  }
  if (!Array.isArray(arr)) {
    warnings.push("cursor: aiService.generations is not an array");
    return { generations, warnings };
  }

  for (const item of arr) {
    const parsed = normalizeRow(item);
    if (parsed) generations.push(parsed);
  }

  generations.sort((a, b) => a.unixMs - b.unixMs);
  return { generations, warnings };
}

function normalizeRow(raw: unknown): CursorGenerationRow | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const unixMs = toNumber(r.unixMs) ?? toNumber(r.timestamp);
  const generationUUID = typeof r.generationUUID === "string" ? r.generationUUID : undefined;
  if (unixMs === undefined || !generationUUID) return null;
  const tokenRaw = r.tokenCount as Record<string, unknown> | undefined;
  const toolRaw = r.toolFormerData as Record<string, unknown> | undefined;
  const out: CursorGenerationRow = {
    unixMs,
    generationUUID,
  };
  if (typeof r.conversationId === "string") out.conversationId = r.conversationId;
  if (typeof r.textDescription === "string") out.textDescription = r.textDescription;
  if (typeof r.type === "string") out.type = r.type;
  if (typeof r.model === "string") out.model = r.model;
  if (typeof r.mode === "string") out.mode = r.mode;
  if (tokenRaw && typeof tokenRaw === "object") {
    const tc: NonNullable<CursorGenerationRow["tokenCount"]> = {};
    const inT = toNumber(tokenRaw.inputTokens);
    const outT = toNumber(tokenRaw.outputTokens);
    const crT = toNumber(tokenRaw.cacheReadTokens);
    const cwT = toNumber(tokenRaw.cacheWriteTokens);
    if (inT !== undefined) tc.inputTokens = inT;
    if (outT !== undefined) tc.outputTokens = outT;
    if (crT !== undefined) tc.cacheReadTokens = crT;
    if (cwT !== undefined) tc.cacheWriteTokens = cwT;
    out.tokenCount = tc;
  }
  if (toolRaw && typeof toolRaw === "object") {
    const tfd: NonNullable<CursorGenerationRow["toolFormerData"]> = {};
    if (typeof toolRaw.tool === "string") tfd.tool = toolRaw.tool;
    const add = toolRaw.additionalData as Record<string, unknown> | undefined;
    if (add && typeof add === "object" && typeof add.status === "string") {
      tfd.additionalData = { status: add.status };
    }
    out.toolFormerData = tfd;
  }
  return out;
}

function toNumber(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v !== "" && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}

function errStr(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
