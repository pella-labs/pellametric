import "server-only";
import { createSign } from "node:crypto";
import type { RedeliveryDeps } from "@bematist/api";

// Inlined mirror of `apps/ingest/src/github-app/jwt.ts` — the ingest
// workspace doesn't declare "exports" so we can't import it across apps.
// Duplicating is cheap (30 lines, pure crypto, no state). The ingest
// remains authoritative for webhook verification; this copy is only for
// the admin-API redelivery path.
function base64url(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return buf.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function mintAppJwt({
  appId,
  privateKeyPem,
  now = Date.now,
}: {
  appId: string | number;
  privateKeyPem: string;
  now?: () => number;
}): string {
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
  return `${signingInput}.${base64url(signature)}`;
}

/**
 * Production wiring for the GitHub App redelivery endpoint.
 *
 * Auth posture: the `/app/hook/deliveries` endpoints require a GitHub App
 * JWT (NOT an installation token). We mint a fresh JWT per request; App
 * JWTs are cheap (RS256 over ~30 bytes) and expire in 9 minutes.
 *
 * GITHUB_APP_ID + GITHUB_APP_PRIVATE_KEY_PEM env vars are read at boot;
 * if absent, the dep factory throws a clear error so the 500 response
 * surface tells ops what's missing.
 */
export async function getGithubRedeliveryDeps(): Promise<RedeliveryDeps> {
  const appId = process.env.GITHUB_APP_ID;
  const privateKeyPem =
    process.env.GITHUB_APP_PRIVATE_KEY_PEM ??
    resolveFromRef(process.env.GITHUB_APP_PRIVATE_KEY_REF);
  if (!appId) {
    throw new Error(
      "GITHUB_APP_ID is not set — cannot mint GitHub App JWT for /redeliver. See dev-docs/PRD-github-integration.md §19.",
    );
  }
  if (!privateKeyPem) {
    throw new Error(
      "GITHUB_APP_PRIVATE_KEY_PEM (or ref) is not set — cannot mint GitHub App JWT. See dev-docs/PRD-github-integration.md §19.",
    );
  }

  return {
    http: {
      async get(url, headers) {
        const res = await fetch(url, { method: "GET", headers });
        return {
          status: res.status,
          body: await safeJson(res),
          headers: pickRateLimitHeaders(res),
        };
      },
      async post(url, headers) {
        const res = await fetch(url, { method: "POST", headers });
        return {
          status: res.status,
          body: await safeJson(res),
          headers: pickRateLimitHeaders(res),
        };
      },
    },
    appJwtProvider: async () =>
      mintAppJwt({
        appId,
        privateKeyPem,
      }),
  };
}

/** TODO(g3): wire real secrets-store resolver; v1 keeps it env-driven. */
function resolveFromRef(_ref: string | undefined): string | undefined {
  return undefined;
}

async function safeJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function pickRateLimitHeaders(res: Response): Record<string, string> {
  const out: Record<string, string> = {};
  const keys = [
    "retry-after",
    "Retry-After",
    "x-ratelimit-remaining",
    "x-ratelimit-reset",
    "x-github-request-id",
  ];
  for (const k of keys) {
    const v = res.headers.get(k);
    if (v) out[k] = v;
  }
  return out;
}
