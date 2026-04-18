import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseChatInteractionStream,
  parseEditOutcomeStream,
  parseTokensGeneratedStream,
  parseToolUsageStream,
} from "./parseStream";

function tmp(name: string, body: string): string {
  const dir = mkdtempSync(join(tmpdir(), `bematist-cont-ps-${name}-`));
  const path = join(dir, `${name}.jsonl`);
  writeFileSync(path, body);
  return path;
}

test("parseChatInteractionStream parses well-formed lines", async () => {
  const path = tmp(
    "chat",
    `${[
      JSON.stringify({
        eventName: "chat",
        sessionId: "s1",
        interactionId: "i1",
        role: "user",
        modelTitle: "claude-sonnet-4-5",
        modelProvider: "anthropic",
        promptTokens: 100,
        timestamp: "2026-04-16T10:00:00.000Z",
      }),
      JSON.stringify({
        eventName: "chat",
        sessionId: "s1",
        interactionId: "i1",
        role: "assistant",
        modelTitle: "claude-sonnet-4-5",
        modelProvider: "anthropic",
        promptTokens: 100,
        generatedTokens: 30,
        finishReason: "end_turn",
        timestamp: "2026-04-16T10:00:01.000Z",
      }),
    ].join("\n")}\n`,
  );
  const r = await parseChatInteractionStream(path, 0);
  expect(r.lines.length).toBe(2);
  expect(r.malformedCount).toBe(0);
  expect(r.lines[0]?.role).toBe("user");
  expect(r.lines[1]?.role).toBe("assistant");
  rmSync(path, { force: true });
});

test("malformed lines are skipped + counted, not thrown", async () => {
  const path = tmp("tg", `{"good":1}\nNOT JSON\n{"good":2}\n`);
  const r = await parseTokensGeneratedStream(path, 0);
  expect(r.lines.length).toBe(2);
  expect(r.malformedCount).toBe(1);
  rmSync(path, { force: true });
});

test("parseEditOutcomeStream surfaces accepted/rejected as-is", async () => {
  const path = tmp(
    "eo",
    `${[
      JSON.stringify({ sessionId: "s1", editId: "e1", accepted: true }),
      JSON.stringify({ sessionId: "s1", editId: "e2", accepted: false }),
    ].join("\n")}\n`,
  );
  const r = await parseEditOutcomeStream(path, 0);
  expect(r.lines[0]?.accepted).toBe(true);
  expect(r.lines[1]?.accepted).toBe(false);
  rmSync(path, { force: true });
});

test("parseToolUsageStream preserves status enum verbatim", async () => {
  const path = tmp(
    "tu",
    `${[
      JSON.stringify({ sessionId: "s1", toolName: "readFile", status: "ok" }),
      JSON.stringify({ sessionId: "s1", toolName: "exec", status: "error" }),
      JSON.stringify({ sessionId: "s1", toolName: "writeFile", status: "denied" }),
    ].join("\n")}\n`,
  );
  const r = await parseToolUsageStream(path, 0);
  expect(r.lines.map((l) => l.status)).toEqual(["ok", "error", "denied"]);
  rmSync(path, { force: true });
});
