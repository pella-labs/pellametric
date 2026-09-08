// GitHub App webhook helpers (Phase 2, T2.1).
// Single global endpoint per P22 — secret is App-level, route resolves org by
// installation.id. HMAC-SHA256 over the raw request body using
// GITHUB_APP_WEBHOOK_SECRET.

import { createHmac, timingSafeEqual } from "node:crypto";

const PREFIX = "sha256=";

/**
 * Constant-time HMAC verification.
 * `signatureHeader` must be the `X-Hub-Signature-256` header value.
 */
export function verifyWebhookSignature(rawBody: string, signatureHeader: string, secret: string): boolean {
  if (!signatureHeader || !signatureHeader.startsWith(PREFIX)) return false;
  if (!secret) return false;
  const provided = signatureHeader.slice(PREFIX.length);
  const mac = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(mac, "utf8");
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export type GithubWebhookEvent =
  | "ping"
  | "installation"
  | "installation_repositories"
  | "pull_request"
  | "push";

export function parseEventName(header: string | null): GithubWebhookEvent | null {
  if (!header) return null;
  switch (header) {
    case "ping":
    case "installation":
    case "installation_repositories":
    case "pull_request":
    case "push":
      return header;
    default:
      return null;
  }
}
