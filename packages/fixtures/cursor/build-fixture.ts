#!/usr/bin/env bun
import { Database } from "bun:sqlite";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

/**
 * Regenerate packages/fixtures/cursor/state.vscdb + session-fixture.jsonl.
 * Run: `bun packages/fixtures/cursor/build-fixture.ts`.
 */

interface Row {
  unixMs: number;
  generationUUID: string;
  conversationId: string;
  textDescription?: string;
  type?: string;
  model: string;
  mode: "auto" | "pro";
  tokenCount: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  };
  toolFormerData?: {
    tool: string;
    additionalData?: { status: "ok" | "error" };
  };
}

const rows: Row[] = [
  {
    unixMs: 1_744_807_200_000,
    generationUUID: "gen-001-auto",
    conversationId: "conv_A",
    textDescription: "refactor helper",
    type: "chat",
    model: "claude-sonnet-4-5",
    mode: "auto",
    tokenCount: { inputTokens: 1800, outputTokens: 320, cacheReadTokens: 1200 },
    toolFormerData: { tool: "read_file", additionalData: { status: "ok" } },
  },
  {
    unixMs: 1_744_807_260_000,
    generationUUID: "gen-002-auto",
    conversationId: "conv_A",
    type: "chat",
    model: "claude-sonnet-4-5",
    mode: "auto",
    tokenCount: { inputTokens: 400, outputTokens: 150 },
    toolFormerData: { tool: "edit_file", additionalData: { status: "error" } },
  },
  {
    unixMs: 1_744_807_320_000,
    generationUUID: "gen-003-pro",
    conversationId: "conv_B",
    type: "chat",
    model: "claude-opus-4-7",
    mode: "pro",
    tokenCount: { inputTokens: 2100, outputTokens: 890, cacheReadTokens: 300 },
    toolFormerData: { tool: "run_command", additionalData: { status: "ok" } },
  },
  {
    unixMs: 1_744_807_380_000,
    generationUUID: "gen-004-pro",
    conversationId: "conv_B",
    type: "chat",
    model: "claude-opus-4-7",
    mode: "pro",
    tokenCount: { inputTokens: 500, outputTokens: 420 },
  },
];

const here = dirname(new URL(import.meta.url).pathname);
const dbPath = resolve(here, "state.vscdb");
const jsonlPath = resolve(here, "session-fixture.jsonl");
mkdirSync(here, { recursive: true });
try {
  rmSync(dbPath, { force: true });
} catch {}

const db = new Database(dbPath, { create: true });
db.run("CREATE TABLE ItemTable (key TEXT PRIMARY KEY NOT NULL, value BLOB NOT NULL)");
db.run("CREATE TABLE cursorDiskKV (key TEXT PRIMARY KEY, value BLOB)");
db.run("INSERT INTO ItemTable (key, value) VALUES (?, ?)", [
  "aiService.generations",
  JSON.stringify(rows),
]);
db.run("INSERT INTO ItemTable (key, value) VALUES (?, ?)", ["other.unrelated.key", '{"x":1}']);
db.close();

// Emit expected normalized events — keep in lockstep with normalize.ts.
import { normalizeGenerations } from "../../../apps/collector/src/adapters/cursor/normalize";
import { parseCursorState } from "../../../apps/collector/src/adapters/cursor/parse";

const roDb = new Database(dbPath, { readonly: true });
const parsed = parseCursorState(roDb);
roDb.close();
const events = normalizeGenerations(
  parsed.generations,
  { tenantId: "org_acme", engineerId: "eng_cursor_fix", deviceId: "dev_mbp_01", tier: "B" },
  "0.43.0",
);
writeFileSync(jsonlPath, `${events.map((e) => JSON.stringify(e)).join("\n")}\n`);
