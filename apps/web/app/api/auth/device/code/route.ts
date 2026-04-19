// POST /api/auth/device/code — mint a fresh device-auth row for `bematist
// login`. RFC 8628 §3.1–§3.2 shape. Anonymous (the CLI has no credentials
// yet); rate-limited per IP so a leaked URL can't be abused to spam rows.

import { createHash, randomBytes } from "node:crypto";
import {
  DEVICE_CODE_EXPIRES_IN_SEC,
  DEVICE_CODE_POLL_INTERVAL_SEC,
  DeviceCodeRequest,
  type DeviceCodeResponse,
  USER_CODE_ALPHABET,
  USER_CODE_LENGTH,
} from "@bematist/api/schemas/deviceAuth";
import { NextResponse } from "next/server";
import { getDbClients } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEVICE_CODE_BYTES = 32; // 256-bit opaque — never stored, hashed only.
const RATE_LIMIT_PER_MINUTE = 10;

function mintDeviceCode(): { plaintext: string; hash: string } {
  const plaintext = randomBytes(DEVICE_CODE_BYTES).toString("hex");
  const hash = createHash("sha256").update(plaintext).digest("hex");
  return { plaintext, hash };
}

function mintUserCode(): string {
  const bytes = randomBytes(USER_CODE_LENGTH);
  let out = "";
  for (let i = 0; i < USER_CODE_LENGTH; i++) {
    const b = bytes[i] ?? 0;
    out += USER_CODE_ALPHABET[b % USER_CODE_ALPHABET.length];
  }
  return out;
}

function clientIp(req: Request): string {
  // Railway / Vercel / Cloudflare all set X-Forwarded-For; take the left-most
  // entry. Local dev falls through to a sentinel so rate-limit keys are
  // still stable across requests.
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]?.trim() ?? "unknown";
  return req.headers.get("x-real-ip") ?? "local";
}

function baseUrl(req: Request): string {
  // Prefer the explicit app-URL env (set on Railway / prod) over the
  // request's host, which can be a proxy-internal origin. Falls back to
  // the request origin in dev where the env may be unset.
  const fromEnv = process.env.BETTER_AUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  return new URL(req.url).origin;
}

function ingestPublicUrl(): string {
  return process.env.BEMATIST_INGEST_PUBLIC_URL ?? "https://ingest.bematist.dev";
}

export async function POST(req: Request): Promise<Response> {
  // Input validation is defensive — the CLI sends a small payload, but a
  // misbehaving proxy can still hand us a non-JSON body.
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const parsed = DeviceCodeRequest.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", detail: parsed.error.flatten() },
      { status: 400 },
    );
  }

  // Rate limit per IP — 10/min is generous for a CLI (one user should never
  // exceed 2-3 in normal operation). Upscale if we see legitimate support
  // cases hitting it.
  const { redis } = getDbClients();
  const rlKey = `rl:device-code:${clientIp(req)}:${Math.floor(Date.now() / 60_000)}`;
  const rlOk = await redis.setNx(rlKey, "1", 90);
  if (!rlOk) {
    const current = await redis.get(rlKey);
    if (current !== null && Number.parseInt(current, 10) >= RATE_LIMIT_PER_MINUTE) {
      return NextResponse.json(
        { error: "rate_limited", retry_after: 60 },
        { status: 429, headers: { "Retry-After": "60" } },
      );
    }
    // Existing counter; increment via SET with no TTL bump — we over-count
    // slightly at the minute boundary, which is fine for our threshold.
    const next = Number.parseInt(current ?? "0", 10) + 1;
    await redis.set(rlKey, String(next), 90);
  }

  // Mint codes. Retry user_code up to 3x in the astronomical case that the
  // partial unique index (active rows) rejects a collision.
  const { pg } = getDbClients();
  const { plaintext: deviceCode, hash: deviceCodeHash } = mintDeviceCode();
  let userCode = mintUserCode();
  const expiresAt = new Date(Date.now() + DEVICE_CODE_EXPIRES_IN_SEC * 1_000);
  const userAgent = req.headers.get("user-agent") ?? parsed.data.client_version ?? null;

  let inserted = false;
  for (let attempt = 0; attempt < 3 && !inserted; attempt++) {
    try {
      await pg.query(
        `INSERT INTO device_codes (device_code_hash, user_code, expires_at, user_agent)
         VALUES ($1, $2, $3, $4)`,
        [deviceCodeHash, userCode, expiresAt, userAgent],
      );
      inserted = true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!/device_codes_user_code_active_idx/.test(msg)) {
        // Non-collision error — fail loudly.
        return NextResponse.json({ error: "server_error", detail: msg }, { status: 500 });
      }
      userCode = mintUserCode();
    }
  }
  if (!inserted) {
    return NextResponse.json(
      { error: "server_error", detail: "failed to mint unique user_code after 3 attempts" },
      { status: 500 },
    );
  }

  const verificationUri = `${baseUrl(req)}/auth/device`;
  const response: DeviceCodeResponse = {
    device_code: deviceCode,
    user_code: userCode,
    verification_uri: verificationUri,
    verification_uri_complete: `${verificationUri}?code=${encodeURIComponent(userCode)}`,
    expires_in: DEVICE_CODE_EXPIRES_IN_SEC,
    interval: DEVICE_CODE_POLL_INTERVAL_SEC,
  };

  // Cache-Control: no-store — device codes MUST never be served from a CDN.
  return NextResponse.json(response, {
    headers: { "Cache-Control": "no-store", "X-Bematist-Public-Ingest": ingestPublicUrl() },
  });
}
