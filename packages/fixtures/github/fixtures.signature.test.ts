// Fixture-signature round-trip test.
//
// For every fixture under `packages/fixtures/github/<event>/<scenario>.json`,
// read the adjacent `.headers.json` and recompute `X-Hub-Signature-256`
// using the committed fixture secret. The stored header must match the
// recomputed value bit-for-bit — otherwise the fixture has drifted from its
// signing seed and the ingest HMAC verifier would reject it at test time.

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { computeHubSignature256, readFixtureSecret } from "../src/github/sign";

const GITHUB_ROOT = resolve(import.meta.dir);
const FIXTURES_ROOT = resolve(GITHUB_ROOT, "..");

function walkPayloadFiles(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) {
      walkPayloadFiles(full, out);
      continue;
    }
    if (entry.endsWith(".json") && !entry.endsWith(".headers.json")) {
      out.push(full);
    }
  }
}

describe("github fixtures — signature round-trip", () => {
  const payloadFiles: string[] = [];
  walkPayloadFiles(GITHUB_ROOT, payloadFiles);
  const secret = readFixtureSecret(FIXTURES_ROOT);

  test("at least one payload exists", () => {
    expect(payloadFiles.length).toBeGreaterThan(0);
  });

  for (const payloadPath of payloadFiles) {
    const headersPath = payloadPath.replace(/\.json$/, ".headers.json");
    const rel = payloadPath.slice(GITHUB_ROOT.length + 1);
    test(`signature matches: ${rel}`, () => {
      const body = readFileSync(payloadPath, "utf8");
      const headers = JSON.parse(readFileSync(headersPath, "utf8")) as Record<string, string>;
      const expected = computeHubSignature256(body, secret);
      expect(headers["X-Hub-Signature-256"]).toBe(expected);
      expect(headers["X-GitHub-Event"]).toBeDefined();
      expect(headers["X-GitHub-Delivery"]).toBeDefined();
    });
  }
});
