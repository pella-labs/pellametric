// Hand-rolled GitHub App JWT (RS256) minting (Sprint-1 Phase 6, D-S1-16).
//
// We deliberately skip `@octokit/auth-app`:
//   - CLAUDE.md §Tech Stack forbids adding runtime deps without justification
//   - R5: octokit/auth-app's token cache is its only real ergonomic win; the
//     App-JWT minting step itself is ~30 lines of node:crypto.
//
// Signature: RS256 over `${headerB64Url}.${payloadB64Url}` using the app's
// PEM-encoded RSA private key. Test-only key generation via
// `crypto.generateKeyPairSync("rsa", {modulusLength:2048})`.

import { createSign } from "node:crypto";

export function base64url(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return buf.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

export interface MintAppJwtInput {
  appId: string | number;
  privateKeyPem: string;
  /** Injected clock (ms); defaults to Date.now. Tests override. */
  now?: () => number;
}

/**
 * Mint a GitHub-App-scoped JWT. Standard claims:
 *
 * - `iat` = now − 60s  (clock-skew backoff per GitHub docs)
 * - `exp` = now + 9min (GitHub caps at 10min; leave 1min buffer)
 * - `iss` = appId
 *
 * Signed with RS256. Returns the compact JWS.
 */
export function mintAppJwt({ appId, privateKeyPem, now = Date.now }: MintAppJwtInput): string {
  const nowSec = Math.floor(now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iat: nowSec - 60,
    exp: nowSec + 9 * 60,
    iss: typeof appId === "number" ? appId : Number(appId),
  };
  const headerB64 = base64url(JSON.stringify(header));
  const payloadB64 = base64url(JSON.stringify(payload));
  const signingInput = `${headerB64}.${payloadB64}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign(privateKeyPem);
  const signatureB64 = base64url(signature);
  return `${signingInput}.${signatureB64}`;
}
