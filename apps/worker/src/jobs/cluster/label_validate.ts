/**
 * Regex + heuristic validator for cluster labels.
 * Per CLAUDE.md AI Rules: 3–5 words, no URLs, no proper nouns,
 * no engineer identity leakage.
 */

export type LabelRejectionReason =
  | "empty"
  | "too_short"
  | "too_long"
  | "contains_url"
  | "contains_email"
  | "contains_proper_noun"
  | "contains_digits";

/** Common stop-words that suppress proper-noun false positives. */
const COMMON_WORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "but",
  "in",
  "on",
  "at",
  "to",
  "of",
  "for",
  "with",
  "api",
  "ui",
  "db",
  "sql",
  "url",
  "http",
  "https",
  "json",
  "yaml",
  "css",
  "js",
  "ts",
  "go",
  "py",
  "rs",
  "c++",
  "test",
  "tests",
  "testing",
  "ci",
  "cd",
  "aws",
  "gcp",
  "k8s",
  "docker",
]);

const URL_REGEX = /\b(https?:\/\/|www\.)\S+/i;
const EMAIL_REGEX = /[\w.+-]+@[\w-]+\.[\w.-]+/;

function isCapitalized(word: string): boolean {
  if (word.length === 0) return false;
  const first = word[0];
  return first !== undefined && first === first.toUpperCase() && first !== first.toLowerCase();
}

export interface ValidationOutcome {
  ok: boolean;
  reason?: LabelRejectionReason;
  /** When ok=true, this is the normalized (lowercased, trimmed) label. */
  normalized?: string;
}

export function validateLabel(raw: string): ValidationOutcome {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { ok: false, reason: "empty" };

  if (URL_REGEX.test(trimmed)) return { ok: false, reason: "contains_url" };
  if (EMAIL_REGEX.test(trimmed)) return { ok: false, reason: "contains_email" };
  if (/\d/.test(trimmed)) return { ok: false, reason: "contains_digits" };

  // Word-count check: 3–5 words inclusive.
  const words = trimmed.split(/\s+/);
  if (words.length < 3) return { ok: false, reason: "too_short" };
  if (words.length > 5) return { ok: false, reason: "too_long" };

  // Proper-noun heuristic: any >=5-char token that is capitalized AND is
  // not in the stop list is flagged. Lowercase 'refactor', 'api routes',
  // 'docker image' etc. pass; 'Sarah', 'GitHub', 'Alice' get flagged.
  for (const w of words) {
    const cleaned = w.replace(/[^\w]/g, "");
    if (cleaned.length >= 5 && isCapitalized(cleaned) && !COMMON_WORDS.has(cleaned.toLowerCase())) {
      return { ok: false, reason: "contains_proper_noun" };
    }
  }

  return { ok: true, normalized: trimmed.toLowerCase() };
}
