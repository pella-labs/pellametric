import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * One-time signed cookie used to hand a fresh ingest-key bearer plaintext
 * from a post-auth route (`/post-auth/new-org`, `/post-auth/accept-invite`)
 * to `/welcome`. The bearer NEVER lives in the URL and NEVER in a client
 * bundle — only in an HttpOnly cookie that `/welcome` reads once and
 * immediately clears.
 *
 * Cookie contract (shared with teammate `invites`):
 *   Name:  `bematist-welcome-bearer`
 *   Value: `base64url(payload).base64url(sig)` where
 *          payload = JSON.stringify({ bearer, keyId, orgSlug, issuedAt, nonce })
 *          sig     = HMAC-SHA256(BETTER_AUTH_SECRET, payloadB64)
 *   Attrs: HttpOnly; Secure (prod); SameSite=Lax; Path=/welcome; Max-Age=120s
 *
 * Why HMAC-sign even though the cookie is HttpOnly? Defense in depth: if a
 * future middleware bug ever exposes it to the client, or an upstream proxy
 * forwards it somewhere it shouldn't, the signature still binds the bearer
 * to this app's secret so it can't be replayed on another tenant.
 *
 * Why 120s Max-Age? Long enough for a human-speed post-OAuth redirect
 * (usually <5s); short enough that a stray cookie never persists through
 * a sign-out/sign-in. `/welcome` deletes the cookie on read regardless.
 */

export const WELCOME_BEARER_COOKIE_NAME = "bematist-welcome-bearer";
export const WELCOME_BEARER_COOKIE_PATH = "/welcome";
export const WELCOME_BEARER_COOKIE_TTL_S = 120;

export interface WelcomeBearerPayload {
  bearer: string;
  keyId: string;
  orgSlug: string;
  /** Issued-at epoch millis — used to bound replay within Max-Age. */
  issuedAt: number;
  /** 16-byte random nonce; present so two sealings of the same bearer differ. */
  nonce: string;
}

/**
 * Seal a bearer into a base64url-encoded cookie value.
 *
 * `secret` must be the app's HMAC key (`BETTER_AUTH_SECRET`). Callers pass it
 * explicitly so this module has no env-reading side effects and is trivially
 * unit-testable.
 */
export function sealWelcomeBearer(
  input: Omit<WelcomeBearerPayload, "issuedAt" | "nonce">,
  secret: string,
  opts: { now?: number; nonce?: string } = {},
): string {
  if (!secret || secret.length === 0) {
    throw new Error("sealWelcomeBearer: secret required");
  }
  const payload: WelcomeBearerPayload = {
    bearer: input.bearer,
    keyId: input.keyId,
    orgSlug: input.orgSlug,
    issuedAt: opts.now ?? Date.now(),
    nonce: opts.nonce ?? randomBytes(16).toString("hex"),
  };
  const payloadB64 = base64urlEncode(Buffer.from(JSON.stringify(payload), "utf8"));
  const sig = hmacSha256(secret, payloadB64);
  const sigB64 = base64urlEncode(sig);
  return `${payloadB64}.${sigB64}`;
}

export type OpenResult =
  | { ok: true; payload: WelcomeBearerPayload }
  | { ok: false; reason: "malformed" | "bad_sig" | "expired" | "empty" };

/**
 * Verify + decode a cookie value. Returns a discriminated result — callers
 * that saw `ok: false` can log the `reason` for debugging without leaking
 * details to the user (just render "view in /admin/ingest-keys").
 *
 * Uses `timingSafeEqual` for signature compare. Max-age is re-checked
 * against `ttlSeconds` so a cookie that somehow survived past its
 * Set-Cookie Max-Age (clock skew, rogue proxy) is rejected server-side.
 */
export function openWelcomeBearer(
  cookieValue: string | null | undefined,
  secret: string,
  opts: { now?: number; ttlSeconds?: number } = {},
): OpenResult {
  if (!cookieValue || cookieValue.length === 0) {
    return { ok: false, reason: "empty" };
  }
  const parts = cookieValue.split(".");
  if (parts.length !== 2) return { ok: false, reason: "malformed" };
  const [payloadB64, sigB64] = parts as [string, string];

  const expectedSig = hmacSha256(secret, payloadB64);
  const providedSig = base64urlDecode(sigB64);
  if (expectedSig.length !== providedSig.length) return { ok: false, reason: "bad_sig" };
  if (!timingSafeEqual(expectedSig, providedSig)) return { ok: false, reason: "bad_sig" };

  let payload: WelcomeBearerPayload;
  try {
    const json = base64urlDecode(payloadB64).toString("utf8");
    const parsed = JSON.parse(json) as unknown;
    if (!isWelcomeBearerPayload(parsed)) return { ok: false, reason: "malformed" };
    payload = parsed;
  } catch {
    return { ok: false, reason: "malformed" };
  }

  const ttlMs = (opts.ttlSeconds ?? WELCOME_BEARER_COOKIE_TTL_S) * 1000;
  const now = opts.now ?? Date.now();
  if (now - payload.issuedAt > ttlMs) return { ok: false, reason: "expired" };
  // Cookies issued in the future (clock skew > 60s) are suspicious — reject.
  if (payload.issuedAt - now > 60_000) return { ok: false, reason: "expired" };

  return { ok: true, payload };
}

function hmacSha256(secret: string, data: string): Buffer {
  return createHmac("sha256", secret).update(data).digest();
}

function base64urlEncode(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlDecode(s: string): Buffer {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  return Buffer.from(padded, "base64");
}

function isWelcomeBearerPayload(x: unknown): x is WelcomeBearerPayload {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.bearer === "string" &&
    o.bearer.length > 0 &&
    typeof o.keyId === "string" &&
    o.keyId.length > 0 &&
    typeof o.orgSlug === "string" &&
    o.orgSlug.length > 0 &&
    typeof o.issuedAt === "number" &&
    Number.isFinite(o.issuedAt) &&
    typeof o.nonce === "string" &&
    o.nonce.length > 0
  );
}
