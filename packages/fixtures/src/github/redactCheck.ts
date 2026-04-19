// Shared redaction ruleset for GitHub fixture payloads.
//
// The recorder CLI (record.ts) and the CI gate
// (packages/fixtures/github/fixtures.redaction.test.ts) share this code so
// they can NEVER drift — a fixture that passes the recorder but fails the
// gate would be a correctness bug.
//
// Rules mirror those enumerated in PRD §13 Phase G0:
//
//   • real top-level domains (anything not in ALLOWED_DOMAINS)
//   • PEM blocks (`-----BEGIN` / `-----END`)
//   • `@` in strings (outside ALLOWED_DOMAINS email shapes)
//   • real-looking GitHub personal-access-token prefixes
//     (ghp_, gho_, ghu_, ghs_, ghr_)

export const ALLOWED_DOMAINS: ReadonlySet<string> = new Set([
  "example.com",
  "example.org",
  "example.net",
  "test.invalid",
  "bematist.local",
]);

export const ALLOWED_NON_DOMAIN_LITERALS: readonly string[] = [
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

/**
 * File extensions that share a TLD-looking shape (`ci.yml`, `app.ts`, …) and
 * appear in legitimate GitHub webhook payload fields like
 * `workflow.path=".github/workflows/ci.yml"`. Treat any candidate whose
 * suffix matches as a file rather than a domain.
 */
export const FILE_EXTENSION_ALLOWLIST: ReadonlySet<string> = new Set([
  "md",
  "yml",
  "yaml",
  "json",
  "js",
  "ts",
  "tsx",
  "jsx",
  "py",
  "rs",
  "go",
  "sql",
  "txt",
  "lock",
  "toml",
  "env",
  "sh",
  "zsh",
  "html",
  "css",
]);

export const PEM_MARKERS = ["-----BEGIN", "-----END"] as const;

export const REAL_GITHUB_TOKEN_PREFIXES = ["ghp_", "gho_", "ghu_", "ghs_", "ghr_"] as const;

const DOMAIN_RE = /\b([a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)+)\b/gi;

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

function isAllowedDomainSuffix(candidate: string): boolean {
  for (const d of ALLOWED_DOMAINS) {
    if (candidate === d || candidate.endsWith(`.${d}`)) return true;
  }
  return false;
}

function checkDomains(str: string, offenses: string[]): void {
  DOMAIN_RE.lastIndex = 0;
  for (const m of str.matchAll(DOMAIN_RE)) {
    const candidate = m[1]?.toLowerCase();
    if (!candidate) continue;
    const dotIdx = candidate.lastIndexOf(".");
    if (dotIdx < 0) continue;
    const tld = candidate.slice(dotIdx + 1);
    if (!/^[a-z]{2,}$/.test(tld)) continue;
    if (FILE_EXTENSION_ALLOWLIST.has(tld)) continue;
    if (isAllowedDomainSuffix(candidate)) continue;
    if (
      ALLOWED_NON_DOMAIN_LITERALS.some(
        (lit) => str.includes(lit) && lit.toLowerCase().includes(candidate.toLowerCase()),
      )
    ) {
      continue;
    }
    offenses.push(`real-looking domain "${candidate}"`);
  }
}

function checkPem(str: string, offenses: string[]): void {
  for (const marker of PEM_MARKERS) {
    if (str.includes(marker)) offenses.push(`PEM marker "${marker}"`);
  }
}

function checkAtSymbol(str: string, offenses: string[]): void {
  if (!str.includes("@")) return;
  const atRe = /@([A-Za-z0-9][A-Za-z0-9.-]*)/g;
  for (const m of str.matchAll(atRe)) {
    const host = m[1]?.toLowerCase();
    if (!host) {
      offenses.push(`bare "@" found (no host)`);
      continue;
    }
    if (!isAllowedDomainSuffix(host)) {
      offenses.push(`"@${host}" outside allowed fixture domains`);
    }
  }
}

function checkGithubTokens(str: string, offenses: string[]): void {
  for (const prefix of REAL_GITHUB_TOKEN_PREFIXES) {
    if (str.includes(prefix)) offenses.push(`GitHub token prefix "${prefix}"`);
  }
}

export interface RedactionCheckResult {
  ok: boolean;
  offenses: string[];
}

/**
 * Apply the full ruleset to an already-parsed JSON value (or raw string).
 * Returns { ok, offenses } — callers decide how to surface failure.
 *
 * Walks string values deeply, plus runs PEM/token checks against the
 * serialized JSON to catch escape-encoded sneaks.
 */
export function redactionCheck(payload: unknown): RedactionCheckResult {
  const offenses: string[] = [];
  const raw = typeof payload === "string" ? payload : JSON.stringify(payload);
  checkPem(raw, offenses);
  checkGithubTokens(raw, offenses);
  const parsed = typeof payload === "string" ? JSON.parse(payload) : payload;
  for (const s of flattenStrings(parsed)) {
    checkDomains(s, offenses);
    checkAtSymbol(s, offenses);
  }
  return { ok: offenses.length === 0, offenses };
}
