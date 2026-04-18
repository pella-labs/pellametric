// JS-native Gitleaks-style secondary scanner (contract 08 Pipeline Order §2).
//
// Runs after TruffleHog to mop up patterns the higher-precision rules miss:
// generic long hex/base64 credentials adjacent to `key`/`token`/`secret`,
// URL-embedded basic auth, Google OAuth refresh, Twilio SIDs, SendGrid keys,
// NPM tokens, common CI secrets.

import type { Engine, Find } from "./types";

interface Rule {
  readonly rule: string;
  readonly type: "secret";
  readonly pattern: RegExp;
  readonly narrowToGroup1?: boolean;
  readonly validate?: (value: string) => boolean;
}

const RULES: ReadonlyArray<Rule> = [
  {
    rule: "TwilioSID",
    type: "secret",
    pattern: /\bAC[a-f0-9]{32}\b/g,
  },
  {
    rule: "TwilioAuthToken",
    type: "secret",
    pattern: /\bSK[a-f0-9]{32}\b/g,
  },
  {
    rule: "SendGridAPIKey",
    type: "secret",
    pattern: /\bSG\.[A-Za-z0-9_-]{22,}\.[A-Za-z0-9_-]{22,}\b/g,
  },
  {
    rule: "NPMToken",
    type: "secret",
    pattern: /\bnpm_[A-Za-z0-9]{36,}\b/g,
  },
  {
    rule: "MailchimpAPIKey",
    type: "secret",
    pattern: /\b[0-9a-f]{32}-us[0-9]{1,2}\b/g,
  },
  {
    rule: "ShopifyPrivateApp",
    type: "secret",
    pattern: /\bshppa_[a-fA-F0-9]{32}\b/g,
  },
  {
    rule: "HerokuAPIKey",
    type: "secret",
    pattern:
      /\bheroku[_-]?(?:api[_-]?key|token)["'\s:=]+[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/gi,
  },
  // URL-embedded basic auth for generic HTTP(S) URLs not handled by
  // TruffleHog's DB-URL rule.
  {
    rule: "BasicAuthURL",
    type: "secret",
    pattern: /\bhttps?:\/\/[^\s:@/]+:[^\s@/]+@[^\s/]+(?:\/[^\s]*)?/g,
  },
  // Google OAuth refresh tokens (`1//`-prefix).
  {
    rule: "GoogleOAuthRefresh",
    type: "secret",
    pattern: /\b1\/\/[0-9A-Za-z_-]{40,}\b/g,
  },
  // Azure connection strings + storage account keys.
  {
    rule: "AzureStorageKey",
    type: "secret",
    pattern:
      /\bDefaultEndpointsProtocol=https?;AccountName=[A-Za-z0-9]+;AccountKey=[A-Za-z0-9+/=]{20,}={0,2}\b/g,
  },
  // PyPI upload tokens.
  {
    rule: "PyPIToken",
    type: "secret",
    pattern: /\bpypi-AgEIcHlwaS5vcmc[A-Za-z0-9_-]{50,}\b/g,
  },
  // Generic API-key-style assignment. Captures the value via group 1; we
  // narrow the marker to that span so the surrounding `api_key=` literal is
  // not redacted.
  {
    rule: "GenericAPIKeyAssignment",
    type: "secret",
    pattern:
      /\b(?:api[_-]?key|access[_-]?token|secret[_-]?key|auth[_-]?token|client[_-]?secret|x-api-key)["'\s:=]+([A-Za-z0-9_\-+/=]{24,})\b/gi,
    narrowToGroup1: true,
    validate(value) {
      if (/^(?:your|xxx+|placeholder|example|redacted|null|none)$/i.test(value)) return false;
      if (value.length < 24) return false;
      return true;
    },
  },
  // Kubernetes ServiceAccount-style `token: eyJ…` assignment.
  {
    rule: "K8sServiceAccountToken",
    type: "secret",
    pattern: /\btoken:\s*(eyJ[A-Za-z0-9_\-.]{40,})\b/g,
    narrowToGroup1: true,
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
      detector: "gitleaks",
      rule: rule.rule,
      value,
    });
    if (re.lastIndex === m.index) re.lastIndex++;
  }
  return out;
}

export const gitleaksEngine: Engine = {
  name: "gitleaks",
  scan(text) {
    if (text.length === 0) return [];
    const all: Find[] = [];
    for (const rule of RULES) {
      all.push(...findSpans(text, rule));
    }
    return all;
  },
};
