// Webhook signature verifiers (Sprint-1 Phase 6, PRD §Phase 6, D-S1-15).
//
// Hand-rolled — CLAUDE.md "No new runtime npm deps" + R5 (octokit/webhooks
// Bun-compat not maintained). All verifiers follow the same recipe:
//
//   1. Length-guard the presented header so `Buffer.from(hex,"hex")` never
//      throws on garbage input.
//   2. `timingSafeEqual` on equal-length Buffers — never string-compare.
//   3. HMAC-SHA256(rawBody, secret) for GitHub/Bitbucket; plaintext compare
//      for GitLab (+ optional IP allowlist per policies.webhook_source_ip_allowlist).
//
// Any parse / length mismatch returns false WITHOUT throwing so the router
// maps cleanly to HTTP 401 (contract 02 §Webhooks).

import { createHmac, timingSafeEqual } from "node:crypto";

export type WebhookSource = "github" | "gitlab" | "bitbucket";

export interface WebhookDelivery {
  source: WebhookSource;
  deliveryId: string;
  event: string;
  rawBody: Uint8Array;
  signature: string;
  sourceIp?: string;
}

export interface WebhookVerifier {
  verify(delivery: WebhookDelivery, secret: Buffer, extra?: { allowlistIps?: string[] }): boolean;
}

// GitHub-style HMAC verifier used by both GitHub (`X-Hub-Signature-256`) and
// Bitbucket (`X-Hub-Signature` — note: no `-256` in the header name, but the
// signature is still sha256). Both emit `sha256=<hex>` bodies.
function verifyHexHmacSha256(rawBody: Uint8Array, presented: string, secret: Buffer): boolean {
  if (typeof presented !== "string" || presented.length === 0) return false;
  if (!presented.startsWith("sha256=")) return false;
  const hex = presented.slice("sha256=".length);
  if (hex.length !== 64) return false;
  // node:crypto returns an empty Buffer for odd-length hex in old node; we've
  // length-guarded above, so Buffer.from is safe here.
  let presentedBuf: Buffer;
  try {
    presentedBuf = Buffer.from(hex, "hex");
  } catch {
    return false;
  }
  if (presentedBuf.length !== 32) return false;
  const mac = createHmac("sha256", secret).update(rawBody).digest();
  if (mac.length !== presentedBuf.length) return false;
  try {
    return timingSafeEqual(mac, presentedBuf);
  } catch {
    return false;
  }
}

const githubHmacSha256: WebhookVerifier = {
  verify(delivery, secret) {
    return verifyHexHmacSha256(delivery.rawBody, delivery.signature, secret);
  },
};

const bitbucketHmacSha256: WebhookVerifier = {
  verify(delivery, secret) {
    return verifyHexHmacSha256(delivery.rawBody, delivery.signature, secret);
  },
};

// GitLab: plaintext shared-secret header + optional source IP allowlist.
// The PRD Phase-6 test 5/6 covers both branches: if allowlistIps is non-empty
// and sourceIp is absent or not in the list → false. If allowlistIps is
// empty/undefined → skip the IP check (dev mode).
const gitlabPlaintext: WebhookVerifier = {
  verify(delivery, secret, extra) {
    const presented = delivery.signature;
    if (typeof presented !== "string" || presented.length === 0) return false;
    const presentedBuf = Buffer.from(presented, "utf8");
    if (presentedBuf.length !== secret.length) return false;
    let ok: boolean;
    try {
      ok = timingSafeEqual(presentedBuf, secret);
    } catch {
      return false;
    }
    if (!ok) return false;
    const allow = extra?.allowlistIps;
    if (allow !== undefined && allow.length > 0) {
      if (!delivery.sourceIp || !allow.includes(delivery.sourceIp)) return false;
    }
    return true;
  },
};

export const verifiers: Record<WebhookSource, WebhookVerifier> = {
  github: githubHmacSha256,
  gitlab: gitlabPlaintext,
  bitbucket: bitbucketHmacSha256,
};
