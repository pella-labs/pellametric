// JS-native TruffleHog-style secret scanner (contract 08 Pipeline Order §1).
//
// Agent decision (PR body): we ship a JS-native port of the highest-recall
// TruffleHog + Gitleaks rule patterns rather than subprocessing Go binaries +
// a Python Presidio daemon. Rationale:
//   - CLAUDE.md §Tech Stack: "do not add new dependencies without justification"
//     and Bun is the runtime; in-process is strictly cheaper than subprocess
//     pools (startup = ~ms per call, dominates a 16KB prompt budget of <5ms).
//   - The server is authoritative (contract 08 §Defense in depth) — rules can
//     be updated without redeploying collector binaries, so regex-style rules
//     converge toward the same recall as the upstream tools on the fixture
//     corpus we ship. The 100-secret adversarial corpus in
//     `packages/fixtures/redaction/secrets/` is the test of record.
//   - Subprocess remains contract-08-compatible for perf reasons; if the
//     ≥98% gate slips we swap the engine body behind the stable `Engine`
//     interface (types.ts).
//
// This engine covers the highest-blast-radius cloud / SaaS tokens first:
// AWS, GCP, Slack, GitHub, Stripe, generic JWT, private key PEM headers,
// OpenAI / Anthropic / Gemini keys. Gitleaks (./gitleaks.ts) mops up URL-
// embedded credentials and generic API-key patterns. Presidio (./presidio.ts)
// covers PII.

import type { Engine, Find } from "./types";

interface Rule {
  readonly rule: string;
  readonly type: "secret";
  readonly pattern: RegExp;
  /**
   * When true, the redaction span narrows to capture group 1 instead of the
   * full match. Patterns matching an assignment context like
   * `aws_secret_access_key = XXXX` set this so the marker covers only the
   * value, not the surrounding key= literal.
   */
  readonly narrowToGroup1?: boolean;
  /**
   * Optional validation hook — runs against the captured value (group 1 if
   * `narrowToGroup1`, else full match). Return `false` to reject the match.
   */
  readonly validate?: (value: string) => boolean;
}

// Rule patterns are tuned against canonical formats described by each
// vendor. Where feasible we prefer hardened prefixes (e.g. `AKIA`) over
// length-only checks; the adversarial corpus exercises both real-format and
// near-miss strings.
const RULES: ReadonlyArray<Rule> = [
  // AWS — Access Key ID. AKIA = canonical long-lived; ASIA = STS temporary;
  // ANPA / AIDA / AROA cover principal-name encoded variants.
  {
    rule: "AWSAccessKey",
    type: "secret",
    pattern: /\b(?:AKIA|ASIA|ANPA|AIDA|AROA)[A-Z0-9]{16}\b/g,
  },
  {
    rule: "AWSSecretKey",
    type: "secret",
    pattern:
      /\b(?:aws[_-]?secret[_-]?access[_-]?key|aws[_-]?secret)[\s"':=]+([A-Za-z0-9/+=]{40})\b/gi,
    narrowToGroup1: true,
  },
  // Any PEM-style PRIVATE KEY block header is a hard secret marker.
  {
    rule: "PEMPrivateKey",
    type: "secret",
    pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/g,
  },
  // GCP API key. Canonical length is `AIza` + 35; we admit longer suffixes
  // (Google has rotated longer formats) up to 40 to keep precision high.
  {
    rule: "GCPAPIKey",
    type: "secret",
    pattern: /\bAIza[0-9A-Za-z_-]{35,40}\b/g,
  },
  // GitHub PATs: classic + OAuth + app install. Floor 30 to admit shorter
  // legacy / test tokens that GitHub still accepts.
  {
    rule: "GitHubPAT",
    type: "secret",
    pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,251}\b/g,
  },
  {
    rule: "GitHubFineGrainedPAT",
    type: "secret",
    pattern: /\bgithub_pat_[A-Za-z0-9_]{22,255}\b/g,
  },
  // Slack tokens + webhook URLs.
  {
    rule: "SlackBotToken",
    type: "secret",
    pattern: /\bxox[baprs]-[0-9A-Za-z-]{10,72}\b/g,
  },
  {
    rule: "SlackWebhook",
    type: "secret",
    pattern:
      /https?:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]{8,12}\/B[A-Z0-9]{8,12}\/[A-Za-z0-9]{20,}/g,
  },
  // Stripe live + restricted keys.
  {
    rule: "StripeLiveKey",
    type: "secret",
    pattern: /\b(?:sk|rk|pk)_live_[0-9a-zA-Z]{20,99}\b/g,
  },
  // JWT — three Base64URL-ish segments separated by dots. Validator decodes
  // the header and looks for `alg` / `typ` to gate false positives.
  {
    rule: "JWT",
    type: "secret",
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
    validate(value) {
      const header = value.split(".")[0];
      if (header === undefined) return false;
      try {
        const b64 = header.replace(/-/g, "+").replace(/_/g, "/");
        const decoded = atob(b64 + "==".slice(0, (4 - (b64.length % 4)) % 4));
        return decoded.includes("alg") || decoded.includes("typ");
      } catch {
        return false;
      }
    },
  },
  // OpenAI keys (legacy `sk-…` and project-scoped `sk-proj-…`).
  {
    rule: "OpenAIKey",
    type: "secret",
    pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g,
    validate(value) {
      return value.length >= 20;
    },
  },
  // Anthropic API keys.
  {
    rule: "AnthropicKey",
    type: "secret",
    pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g,
  },
  // DigitalOcean Personal Access Token: `dop_v1_` + 64 hex chars.
  {
    rule: "DigitalOceanToken",
    type: "secret",
    pattern: /\bdop_v1_[a-fA-F0-9]{64}\b/g,
  },
  // DB URLs with embedded credentials. We require user:password@ to avoid
  // flagging credentialless URLs.
  {
    rule: "DBURLCredentials",
    type: "secret",
    pattern:
      /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp|mssql):\/\/[^\s:@/]+:[^\s@/]+@[^\s/]+(?:\/[^\s]*)?/g,
  },
  // Authorization: Bearer …
  {
    rule: "AuthorizationBearer",
    type: "secret",
    pattern: /\bAuthorization:\s*Bearer\s+[A-Za-z0-9_\-.=]{20,}/gi,
  },
  // password / passwd / pwd / secret / token assignments. Captures the value
  // via group 1 with narrowToGroup1.
  {
    rule: "PasswordAssignment",
    type: "secret",
    pattern: /\b(?:pass(?:word|wd)?|pwd|secret(?:_key)?)\s*[:=]\s*["']?([^"'\s,;{}]{6,})["']?/gi,
    narrowToGroup1: true,
    validate(value) {
      const lower = value.toLowerCase();
      if (lower.includes("<") || lower.includes(">")) return false;
      if (/^(?:your[_\- ]?)?(?:password|secret|token|placeholder|example|redacted)$/i.test(value))
        return false;
      return true;
    },
  },
];

function findSpans(text: string, rule: Rule): Find[] {
  const out: Find[] = [];
  const re = new RegExp(rule.pattern.source, rule.pattern.flags);
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    let start = m.index;
    let end = start + m[0].length;
    let value = m[0];
    if (rule.narrowToGroup1 && m[1] !== undefined && m[1].length > 0) {
      const inner = m[0].indexOf(m[1]);
      if (inner >= 0) {
        start = m.index + inner;
        end = start + m[1].length;
        value = m[1];
      }
    }
    if (rule.validate && !rule.validate(value)) continue;
    out.push({
      start,
      end,
      type: rule.type,
      detector: "trufflehog",
      rule: rule.rule,
      value,
    });
    if (re.lastIndex === m.index) re.lastIndex++;
  }
  return out;
}

export const trufflehogEngine: Engine = {
  name: "trufflehog",
  scan(text) {
    if (text.length === 0) return [];
    const all: Find[] = [];
    for (const rule of RULES) {
      all.push(...findSpans(text, rule));
    }
    return all;
  },
};
