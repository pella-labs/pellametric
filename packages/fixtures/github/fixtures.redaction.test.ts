// GitHub fixture-redaction CI gate (PRD §13 Phase G0 tests #1).
//
// Walks every `*.json` file under `packages/fixtures/github/` (payloads AND
// `.headers.json` sidecars) and fails the build when the shared redaction
// checker (packages/fixtures/src/github/redactCheck.ts) reports any offense.
// Same code path the recorder CLI uses — they cannot drift.
//
// This is the merge blocker for every future fixture-carrying PR.

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { redactionCheck } from "../src/github/redactCheck";

const FIXTURES_ROOT = resolve(import.meta.dir);

function isFixtureJsonFile(name: string): boolean {
  return name.endsWith(".json");
}

function walkJsonFiles(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) {
      walkJsonFiles(full, out);
      continue;
    }
    if (isFixtureJsonFile(entry)) out.push(full);
  }
}

describe("github fixtures — redaction gate", () => {
  const files: string[] = [];
  walkJsonFiles(FIXTURES_ROOT, files);

  test("at least one fixture exists", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    test(`fixture is redacted: ${file.slice(FIXTURES_ROOT.length + 1)}`, () => {
      const raw = readFileSync(file, "utf8");
      // Parse to surface structural issues early.
      const parsed = JSON.parse(raw);
      const { ok, offenses } = redactionCheck(parsed);
      if (!ok) {
        throw new Error(`Fixture redaction violations in ${file}:\n  ${offenses.join("\n  ")}`);
      }
    });
  }
});
