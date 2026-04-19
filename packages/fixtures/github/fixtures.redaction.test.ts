// GitHub fixture-redaction CI gate (PRD §13 G0, decision D33–D60 context).
//
// Walks every `*.json` file under `packages/fixtures/github/` (payloads AND
// `.headers.json` sidecars) and fails the build when a fixture contains any of:
//
//   • a real top-level-domain string (anything not in the allowlist of obvious
//     fixture domains: `example.com`, `test.invalid`, `bematist.local`).
//   • a PEM block marker (`-----BEGIN` / `-----END`).
//   • a real `@` in a string — only allowed inside fixture-domain email shapes
//     (e.g. `engineer@example.com`).
//   • a real-looking GitHub personal-access-token prefix
//     (`ghp_`, `gho_`, `ghu_`, `ghs_`, `ghr_`).
//
// This is the merge blocker for every future fixture-carrying PR — it is the
// "fixture-redaction privacy test" enumerated in PRD §13 Phase G0 tests #1.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, test } from "bun:test";

const FIXTURES_ROOT = resolve(import.meta.dir);

// Fixture-safe domains. Everything else matching `\.\w{2,}` is treated as real.
const ALLOWED_DOMAINS = new Set([
  "example.com",
  "example.org",
  "example.net",
  "test.invalid",
  "bematist.local",
]);

// Strings that may legitimately contain a `.<tld>`-looking sequence but are not
// real domains. Each entry is a fragment that, if present in the surrounding
// value, whitelists the match.
const ALLOWED_NON_DOMAIN_LITERALS = [
  "application/json",
  "application/vnd.github+json",
  "application/vnd.github.v3+json",
  "v1.0",
  "v2.0",
  "v3.0",
  "v4.0",
  "ref/heads/main",
  "refs/heads/main",
  "refs/heads/develop",
  "README.md",
];

const PEM_MARKERS = ["-----BEGIN", "-----END"];
const REAL_GITHUB_TOKEN_PREFIXES = ["ghp_", "gho_", "ghu_", "ghs_", "ghr_"];

// Simple TLD-shaped matcher. Matches `<word>.<2+ letter tld>` anywhere in a
// string. We inspect each hit against the allowlist and the non-domain-literal
// bailout list.
const DOMAIN_RE = /\b([a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)+)\b/gi;

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

function flattenStrings(value: unknown, acc: string[] = []): string[] {
  if (value === null || value === undefined) return acc;
  if (typeof value === "string") {
    acc.push(value);
    return acc;
  }
  if (Array.isArray(value)) {
    for (const v of value) flattenStrings(v, acc);
    return acc;
  }
  if (typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) {
      flattenStrings(v, acc);
    }
  }
  return acc;
}

function checkDomains(str: string, file: string, offenses: string[]): void {
  DOMAIN_RE.lastIndex = 0;
  for (const m of str.matchAll(DOMAIN_RE)) {
    const candidate = m[1]?.toLowerCase();
    if (!candidate) continue;
    // Must actually look like a domain (contain a dot + a 2+ letter tld).
    const dotIdx = candidate.lastIndexOf(".");
    if (dotIdx < 0) continue;
    const tld = candidate.slice(dotIdx + 1);
    if (!/^[a-z]{2,}$/.test(tld)) continue;
    if (ALLOWED_DOMAINS.has(candidate)) continue;
    // Ends-with allowance: tolerate `foo.example.com`, `api.test.invalid`, etc.
    let allowedBySuffix = false;
    for (const d of ALLOWED_DOMAINS) {
      if (candidate === d || candidate.endsWith(`.${d}`)) {
        allowedBySuffix = true;
        break;
      }
    }
    if (allowedBySuffix) continue;
    // Non-domain literals (content-types, version strings, refs, file names).
    if (ALLOWED_NON_DOMAIN_LITERALS.some((lit) => str.includes(lit) && str.includes(candidate))) {
      // If the entire string is one of these literals OR the candidate is a
      // sub-fragment of one (e.g. `v1.0` → candidate `v1.0`), it's safe.
      if (
        ALLOWED_NON_DOMAIN_LITERALS.some((lit) =>
          lit.toLowerCase().includes(candidate.toLowerCase()),
        )
      ) {
        continue;
      }
    }
    offenses.push(`${file}: real-looking domain "${candidate}"`);
  }
}

function checkPem(str: string, file: string, offenses: string[]): void {
  for (const marker of PEM_MARKERS) {
    if (str.includes(marker)) {
      offenses.push(`${file}: PEM marker "${marker}" found`);
    }
  }
}

function checkAtSymbol(str: string, file: string, offenses: string[]): void {
  if (!str.includes("@")) return;
  // Allow `<local>@<allowed-domain>` shape only.
  // Find every @<something>; each must resolve to an allowed-domain suffix.
  const atRe = /@([A-Za-z0-9][A-Za-z0-9.-]*)/g;
  for (const m of str.matchAll(atRe)) {
    const host = m[1]?.toLowerCase();
    if (!host) {
      offenses.push(`${file}: bare "@" found (no host)`);
      continue;
    }
    let allowed = false;
    for (const d of ALLOWED_DOMAINS) {
      if (host === d || host.endsWith(`.${d}`)) {
        allowed = true;
        break;
      }
    }
    if (!allowed) {
      offenses.push(`${file}: "@${host}" outside allowed fixture domains`);
    }
  }
}

function checkGithubTokens(str: string, file: string, offenses: string[]): void {
  for (const prefix of REAL_GITHUB_TOKEN_PREFIXES) {
    if (str.includes(prefix)) {
      offenses.push(`${file}: real-looking GitHub token prefix "${prefix}"`);
    }
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
      // Parse to surface structural issues early; if unparsable, fail loudly.
      const parsed = JSON.parse(raw);
      const strings = flattenStrings(parsed);
      const offenses: string[] = [];
      // Raw-file checks catch things JSON may encode (backslash-escaped PEMs,
      // token prefixes inside opaque blobs, etc.).
      checkPem(raw, file, offenses);
      checkGithubTokens(raw, file, offenses);
      for (const s of strings) {
        checkDomains(s, file, offenses);
        checkAtSymbol(s, file, offenses);
      }
      if (offenses.length > 0) {
        const msg = [`Fixture redaction violations in ${file}:`, ...offenses].join("\n  ");
        throw new Error(msg);
      }
    });
  }
});
