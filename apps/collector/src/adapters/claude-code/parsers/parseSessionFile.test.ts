import { expect, test } from "bun:test";
import { join } from "node:path";
import { parseSessionFile } from "./parseSessionFile";

const FIX_DIR = join(import.meta.dir, "..", "fixtures");

test("parses clean session and sums usage correctly", async () => {
  const result = await parseSessionFile(join(FIX_DIR, "duplicate-request-ids.jsonl"));
  // After max-per-requestId dedup: req_abc = {120, 60}, req_xyz = {80, 40}.
  expect(result.usageTotals.input_tokens).toBe(200);
  expect(result.usageTotals.output_tokens).toBe(100);
});

test("dedup by requestId chooses max per field (D17)", async () => {
  const result = await parseSessionFile(join(FIX_DIR, "duplicate-request-ids.jsonl"));
  // req_abc saw {100,50} then {120,60} → max-per-field keeps {120,60}.
  const requestUsages = result.perRequestUsage.get("req_abc");
  expect(requestUsages?.input_tokens).toBe(120);
  expect(requestUsages?.output_tokens).toBe(60);
});

test("durationMs equals lastTimestamp − firstTimestamp", async () => {
  // Fixture spans 14:00:00.000 → 14:00:02.000 = 2000 ms.
  const result = await parseSessionFile(join(FIX_DIR, "duplicate-request-ids.jsonl"));
  expect(result.durationMs).toBe(2000);
});

test("sessionId extracted from first line with one", async () => {
  const result = await parseSessionFile(join(FIX_DIR, "duplicate-request-ids.jsonl"));
  expect(result.sessionId).toBe("s1");
});

test("entries array preserves line order", async () => {
  const result = await parseSessionFile(join(FIX_DIR, "duplicate-request-ids.jsonl"));
  expect(result.entries.length).toBe(3);
  expect(result.entries[0]?.timestamp).toBe("2026-04-16T14:00:00.000Z");
  expect(result.entries[2]?.timestamp).toBe("2026-04-16T14:00:02.000Z");
});
