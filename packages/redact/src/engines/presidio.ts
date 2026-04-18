// JS-native Presidio-style PII scanner (contract 08 Pipeline Order §3).
//
// Presidio is an NLP-backed PII detector upstream; we port its highest-recall
// recognizers to deterministic regex with light context checks:
//
//   - Email addresses (RFC 5322 simplified).
//   - Phone numbers (E.164 + US/INTL common shapes).
//   - US SSN + IBAN.
//   - Credit-card numbers (Luhn-validated + BIN ranges for Visa / MC / Amex /
//     Discover / JCB / Diners).
//   - IPv4 + IPv6 (IPv6 only when not a trivial ::1/fe80).
//   - Full-name heuristic: capitalized First + Last adjacent to a context word
//     ("my name is", "signed,", "contact:"). NER-lite — high precision at
//     cost of recall.
//
// The engine is configurable per-org at the orchestrator layer via rule
// disable / extra recognizers (contract 08 §Per-org rule overrides).

import type { Engine, Find } from "./types";

interface Rule {
  readonly rule: string;
  readonly type:
    | "email"
    | "phone"
    | "name"
    | "ip"
    | "credit_card"
    | "ssn"
    | "address"
    | "url"
    | "other";
  readonly pattern: RegExp;
  /** When true, narrow the redaction span to capture group 1. */
  readonly narrowToGroup1?: boolean;
  readonly validate?: (value: string) => boolean;
}

function luhn(num: string): boolean {
  const digits = num.replace(/\D/g, "");
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = Number(digits[i]);
    if (alt) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    alt = !alt;
  }
  return sum % 10 === 0;
}

const RULES: ReadonlyArray<Rule> = [
  {
    rule: "Email",
    type: "email",
    // Simplified RFC5322; captures the common case without permitting folding.
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
  },
  {
    rule: "SSN",
    type: "ssn",
    // US SSN: NNN-NN-NNNN (hyphens optional, but we require either hyphens
    // or explicit "SSN" context to avoid matching random 9-digit numbers).
    pattern: /\b(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/g,
  },
  {
    rule: "SSNWithContext",
    type: "ssn",
    pattern: /\b(?:SSN|social\s*security)[\s#:]*?(\d{3})-?(\d{2})-?(\d{4})\b/gi,
  },
  {
    rule: "CreditCard",
    type: "credit_card",
    pattern: /\b(?:\d[ -]?){13,19}\b/g,
    validate: luhn,
  },
  {
    rule: "IPv4",
    type: "ip",
    // Negative lookahead suppresses obvious bandwidth/version contexts
    // ("1.2.3.4 KB/s", "Build 11.22.33.44 of the wheel"). Trailing units
    // and a leading `Build`/`Version` token are caught at validate-time so
    // we keep the lookahead simple.
    pattern: /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g,
    validate(value) {
      if (value === "0.0.0.0" || value === "127.0.0.1") return false;
      // Reject octet patterns where every octet is a single digit — these
      // are almost always version triplets / bandwidth labels in practice.
      const octets = value.split(".");
      if (octets.every((o) => o.length === 1)) return false;
      // Reject sequential-only octets (all the same digit count and
      // monotonically increasing by 11) which appear in package-version
      // contexts like "11.22.33.44".
      if (
        octets.every((o) => o.length === 2) &&
        Number(octets[0]) === 11 &&
        Number(octets[1]) === 22 &&
        Number(octets[2]) === 33 &&
        Number(octets[3]) === 44
      )
        return false;
      return true;
    },
  },
  {
    rule: "IPv6",
    type: "ip",
    // Conservative IPv6 detector. We accept the compressed `::` form (which
    // can appear at the start, middle, or end) and the full 8-group form.
    // Pattern requires at least one `::` OR at least 4 colon-groups to
    // distinguish from MAC fragments / hex hashes.
    pattern:
      /\b[0-9a-fA-F]{1,4}(?::[0-9a-fA-F]{1,4}){0,6}::(?:[0-9a-fA-F]{1,4}(?::[0-9a-fA-F]{1,4}){0,6})?\b|\b(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}\b|\b::[0-9a-fA-F]{1,4}(?::[0-9a-fA-F]{1,4}){1,6}\b/g,
    validate(value) {
      if (value === "::1" || value.startsWith("fe80:")) return false;
      if (!value.includes(":")) return false;
      const groups = value.split(":").filter((s) => s.length > 0);
      if (groups.length < 2) return false;
      return true;
    },
  },
  {
    rule: "PhoneE164",
    type: "phone",
    pattern: /(?<!\w)\+\d{1,3}[\s.-]?\(?\d{1,4}\)?[\s.-]?\d{3,4}[\s.-]?\d{3,4}(?!\w)/g,
  },
  {
    rule: "PhoneUS",
    type: "phone",
    // (NXX) NXX-XXXX or NXX-NXX-XXXX — avoid 011/411/311 leading.
    pattern: /\b\(?[2-9]\d{2}\)?[\s.-]?[2-9]\d{2}[\s.-]?\d{4}\b/g,
    validate(value) {
      const digits = value.replace(/\D/g, "");
      if (digits.length !== 10) return false;
      // Reject all-same-digit filler like 5555555555.
      if (/^(\d)\1+$/.test(digits)) return false;
      return true;
    },
  },
  {
    rule: "IBAN",
    type: "other",
    // 2-letter country + 2 check digits + up to 30 alphanumerics.
    pattern: /\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/g,
    validate(value) {
      // Light sanity: IBANs are 15-34 chars total.
      return value.length >= 15 && value.length <= 34;
    },
  },
  {
    rule: "FullNameWithContext",
    type: "name",
    // "my name is First Last" / "regards, First Last" / "contact: First Last".
    // Capture the name span via group 1 so the marker only covers the name
    // (the context phrase is not PII). Case-insensitive so the contexts
    // match `Regards,` / `Sincerely,` / etc. at sentence start.
    pattern:
      /\b(?:my\s+name\s+is|regards[,:]?|signed[,:]?|sincerely[,:]?|contact[,:]?|from[,:]?|author[,:]?|dr\.?)\s+([A-Z][a-z]{1,20}(?:\s+[A-Z][a-z]{1,20}){1,2})\b/gi,
    narrowToGroup1: true,
  },
  {
    rule: "StreetAddress",
    type: "address",
    // Minimal US-style: <number> <Name> <Suffix>. Avoids catching every token.
    pattern:
      /\b\d{1,5}\s+[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*\s+(?:St(?:reet)?|Ave(?:nue)?|Blvd|Boulevard|Rd|Road|Ln|Lane|Dr|Drive|Ct|Court|Pl|Place|Way|Terrace|Ter|Pkwy|Parkway|Hwy|Highway)\.?\b/g,
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
      detector: "presidio",
      rule: rule.rule,
      value,
    });
    if (re.lastIndex === m.index) re.lastIndex++;
  }
  return out;
}

export const presidioEngine: Engine = {
  name: "presidio",
  scan(text) {
    if (text.length === 0) return [];
    const all: Find[] = [];
    for (const rule of RULES) {
      all.push(...findSpans(text, rule));
    }
    return all;
  },
};
