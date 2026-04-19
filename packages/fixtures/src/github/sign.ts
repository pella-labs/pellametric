// Shared HMAC helper for GitHub fixture headers. Keeps the recorder and any
// future test helpers in lock-step with apps/ingest/src/webhooks/verify.ts
// (which computes sha256 over the raw body and prepends "sha256=").
//
// Hand-rolled via node:crypto — no new deps (CLAUDE.md "in-repo + Node stdlib
// + Bun builtins preferred").

import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export const FIXTURE_SECRET_RELATIVE_PATH = "github/.webhook-secret";

/** Read the committed fixture webhook secret. Trims trailing whitespace. */
export function readFixtureSecret(fixturesRoot: string): string {
  const p = resolve(fixturesRoot, FIXTURE_SECRET_RELATIVE_PATH);
  return readFileSync(p, "utf8").trim();
}

/**
 * Compute the `X-Hub-Signature-256` header value GitHub would send for
 * `rawBody` signed with `secret`. Matches GitHub's canonical shape:
 *
 *   X-Hub-Signature-256: sha256=<hex>
 */
export function computeHubSignature256(rawBody: Uint8Array | string, secret: string): string {
  const body = typeof rawBody === "string" ? Buffer.from(rawBody, "utf8") : Buffer.from(rawBody);
  const digest = createHmac("sha256", secret).update(body).digest("hex");
  return `sha256=${digest}`;
}
