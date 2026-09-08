// Phase 2 hot-path §4.3 — commit message redaction (P20).
// Regex set per challenger §D2. Order matters — specific patterns run first
// so the generic high-entropy sweep doesn't shadow a typed match.

type Rule = { name: string; re: RegExp };

const RULES: Rule[] = [
  { name: "aws_key",     re: /AKIA[0-9A-Z]{16}/g },
  { name: "github_pat",  re: /gh[pousr]_[A-Za-z0-9]{36,}/g },
  { name: "anthropic",   re: /sk-ant-[A-Za-z0-9_-]{20,}/g },
  { name: "openai",      re: /sk-[A-Za-z0-9]{32,}/g },
];

// Generic high-entropy: only flag when surrounded by MIME-like boundaries
// (start/end-of-string, whitespace, `:`, `=`, quote). Prevents replacing
// long file paths or hex SHAs inside commit prose.
const GENERIC_RE = /(^|[\s:="'`<>])([A-Za-z0-9_+/=-]{32,})(?=$|[\s:="'`<>])/g;

const MAX_LEN = 1024;

export function redactCommitMessage(message: string): {
  redacted: string;
  wasRedacted: boolean;
  truncated: boolean;
} {
  let out = message ?? "";
  let touched = false;

  for (const rule of RULES) {
    const before = out;
    out = out.replace(rule.re, `[REDACTED:${rule.name}]`);
    if (out !== before) touched = true;
  }

  // Generic sweep flags for review but only auto-redacts when not already
  // matched by a typed rule above (avoids double-replacement).
  out = out.replace(GENERIC_RE, (_m, prefix: string, body: string) => {
    if (body.startsWith("[REDACTED:")) return `${prefix}${body}`;
    touched = true;
    return `${prefix}[REDACTED:high_entropy]`;
  });

  let truncated = false;
  if (out.length > MAX_LEN) {
    out = out.slice(0, MAX_LEN);
    truncated = true;
  }

  return { redacted: out, wasRedacted: touched, truncated };
}
