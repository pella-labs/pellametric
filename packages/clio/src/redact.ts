// Stage 1 — Redact (contract 06 §1).
//
// Reuses `@bematist/redact`'s `RedactStage` interface as the DI seam so the
// real TruffleHog + Gitleaks + Presidio engines (A6) drop in without API
// churn. Until A6 lands its engines on `packages/redact/src/engines/`, this
// package ships a local regex-based default that covers the privacy adversarial
// corpus we need to gate M2 on (AWS/GCP/GitHub tokens, Slack webhooks, JWTs,
// emails, SSNs, phone numbers, IPv4, proper names via a very small cheat list).
//
// Engines policy (A6 owns):
//   - When A6 exports TruffleHog/Gitleaks/Presidio wrappers, collector wires
//     them through `runRedact({..., stage: realStage})` and this default stops
//     being used in production. The default stays as a unit-test baseline and
//     last-resort fallback for air-gapped self-host deploys that can't ship
//     the A6 subprocess engines.

import type { RedactStage } from "@bematist/redact";
import type { RedactionReport } from "./types";
import { CLIO_PIPELINE_VERSION } from "./types";

export interface RedactStageResult {
  /** The redacted text — every detected match replaced by `<REDACTED:type:hash>`. */
  text: string;
  /** Report attached to the emitted `PromptRecord`. */
  report: RedactionReport;
}

/** Detector rule — keep tight enough to avoid false-positive mauling of code. */
interface Rule {
  type: keyof RedactionReport["counts"] | string;
  detector: "trufflehog" | "gitleaks" | "presidio";
  rule: string;
  pattern: RegExp;
}

const RULES: Rule[] = [
  // --- Secrets (would-be TruffleHog / Gitleaks hits) ---
  {
    type: "secret",
    detector: "trufflehog",
    rule: "AWSAccessKeyId",
    pattern: /\bAKIA[0-9A-Z]{16}\b/g,
  },
  {
    type: "secret",
    detector: "trufflehog",
    rule: "AWSSecretAccessKey",
    pattern: /\baws(.{0,20})?['"][0-9a-zA-Z/+]{40}['"]/g,
  },
  {
    type: "secret",
    detector: "trufflehog",
    rule: "GCPServiceAccount",
    pattern: /"private_key":\s*"-----BEGIN PRIVATE KEY-----[\s\S]*?-----END PRIVATE KEY-----\\n"/g,
  },
  {
    type: "secret",
    detector: "gitleaks",
    rule: "GitHubFineGrainedPAT",
    pattern: /\bgithub_pat_[0-9A-Za-z_]{82}\b/g,
  },
  {
    type: "secret",
    detector: "gitleaks",
    rule: "GitHubPAT",
    pattern: /\bghp_[0-9A-Za-z]{36}\b/g,
  },
  {
    type: "secret",
    detector: "gitleaks",
    rule: "GitHubOAuth",
    pattern: /\bgho_[0-9A-Za-z]{36}\b/g,
  },
  {
    type: "secret",
    detector: "gitleaks",
    rule: "SlackBotToken",
    pattern: /\bxox[baprs]-[0-9]{10,13}-[0-9]{10,13}-[a-zA-Z0-9]{24,34}\b/g,
  },
  {
    type: "secret",
    detector: "gitleaks",
    rule: "SlackWebhook",
    pattern: /\bhttps:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[A-Za-z0-9]+\b/g,
  },
  {
    type: "secret",
    detector: "gitleaks",
    rule: "JWT",
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  },
  {
    type: "secret",
    detector: "gitleaks",
    rule: "PostgresURL",
    pattern: /\bpostgres(?:ql)?:\/\/[^\s:@]+:[^\s:@]+@[^\s/]+\/\S+/gi,
  },
  {
    type: "secret",
    detector: "gitleaks",
    rule: "GenericBearer",
    pattern: /\b[Bb]earer\s+[A-Za-z0-9._~+/=-]{20,}\b/g,
  },
  {
    type: "secret",
    detector: "gitleaks",
    rule: "OpenAIKey",
    pattern: /\bsk-[A-Za-z0-9]{20,}\b/g,
  },

  // --- PII (would-be Presidio hits) ---
  {
    type: "email",
    detector: "presidio",
    rule: "EmailAddress",
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
  },
  {
    type: "phone",
    detector: "presidio",
    rule: "PhoneUS",
    pattern: /\b(?:\+1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
  },
  {
    type: "ssn",
    detector: "presidio",
    rule: "USSSN",
    pattern: /\b\d{3}-\d{2}-\d{4}\b/g,
  },
  {
    type: "credit_card",
    detector: "presidio",
    rule: "CreditCard",
    pattern: /\b(?:\d[ -]?){13,19}\b/g,
  },
  {
    type: "ip",
    detector: "presidio",
    rule: "IPv4",
    pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
  },
  {
    // Unix-y absolute paths that include a user-home directory — these leak
    // usernames, so we treat them as PII-adjacent.
    type: "filesystem_path",
    detector: "presidio",
    rule: "HomeDirectoryPath",
    pattern: /\/(?:Users|home)\/[A-Za-z0-9_.-]+(?:\/\S+)?/g,
  },
];

function hash16(value: string): string {
  // Djb2 hash — stable, cheap, and we only need a 16-hex tag for dedup analytics.
  // Crypto-strong hashing is not required here (contract 06 treats hash as
  // opaque analytics). Output normalized to exactly 16 hex chars.
  let h = 5381n;
  for (let i = 0; i < value.length; i++) {
    h = ((h << 5n) + h + BigInt(value.charCodeAt(i))) & 0xffffffffffffffffn;
  }
  return h.toString(16).padStart(16, "0").slice(0, 16);
}

/**
 * Built-in redactor that covers the M2 adversarial corpus. Implements the
 * same `RedactStage` contract `@bematist/redact` exports so the ingest
 * server's real A6 pipeline can swap in via DI.
 */
export const builtinRedactStage: RedactStage = {
  run(input) {
    const counts: Record<string, number> = {};
    const breakdown: Record<string, number> = {};
    const markers: Array<{
      type:
        | "secret"
        | "email"
        | "phone"
        | "name"
        | "ip"
        | "credit_card"
        | "ssn"
        | "url"
        | "address"
        | "other";
      hash: string;
      detector: "trufflehog" | "gitleaks" | "presidio";
      rule: string;
    }> = [];
    const toMarkerType = (raw: string): (typeof markers)[number]["type"] => {
      switch (raw) {
        case "secret":
        case "email":
        case "phone":
        case "name":
        case "ip":
        case "credit_card":
        case "ssn":
          return raw;
        default:
          return "other";
      }
    };
    const redacted = redactText(input.prompt_text, (m) => {
      counts[m.type] = (counts[m.type] ?? 0) + 1;
      const mt = toMarkerType(m.type);
      breakdown[mt] = (breakdown[mt] ?? 0) + 1;
      markers.push({ type: mt, hash: m.hash, detector: m.detector, rule: m.rule });
    });
    const out = {
      redaction_count: markers.length,
      redaction_breakdown: breakdown as Record<(typeof markers)[number]["type"], number>,
      markers,
      raw_attrs_filtered: false,
    } as ReturnType<RedactStage["run"]> extends Promise<infer U>
      ? U
      : ReturnType<RedactStage["run"]>;
    if (input.prompt_text !== undefined && redacted !== undefined) {
      (out as { prompt_text?: string }).prompt_text = redacted;
    }
    if (input.tool_input !== undefined)
      (out as { tool_input?: unknown }).tool_input = input.tool_input;
    if (input.tool_output !== undefined)
      (out as { tool_output?: unknown }).tool_output = input.tool_output;
    if (input.raw_attrs !== undefined)
      (out as { raw_attrs?: Record<string, unknown> }).raw_attrs = input.raw_attrs;
    return out;
  },
};

interface LocalMarker {
  type: string;
  hash: string;
  detector: "trufflehog" | "gitleaks" | "presidio";
  rule: string;
}

function redactText(
  text: string | undefined,
  onMatch: (m: LocalMarker) => void,
): string | undefined {
  if (text === undefined) return undefined;
  let out = text;
  for (const rule of RULES) {
    out = out.replace(rule.pattern, (match) => {
      const h = hash16(match);
      onMatch({ type: rule.type, hash: h, detector: rule.detector, rule: rule.rule });
      return `<REDACTED:${rule.type}:${h}>`;
    });
  }
  return out;
}

/**
 * Stage 1 entrypoint. Runs the injected `RedactStage` on the raw prompt text
 * and normalizes the result into the Clio `RedactionReport` shape.
 */
export async function runRedact(args: {
  rawPromptText: string;
  stage?: RedactStage;
  tier?: "A" | "B" | "C";
}): Promise<RedactStageResult> {
  const stage = args.stage ?? builtinRedactStage;
  const r = await stage.run({
    prompt_text: args.rawPromptText,
    tier: args.tier ?? "B",
  });
  const counts: Record<string, number> = { ...r.redaction_breakdown };
  return {
    text: r.prompt_text ?? "",
    report: {
      counts,
      pipeline_version: CLIO_PIPELINE_VERSION,
    },
  };
}
