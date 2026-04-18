/**
 * Ed25519 signed-config verifier — D20.
 *
 * Tenant-wide Tier-C admin flips require a detached Ed25519 signature from
 * a pinned signer. The authoritative pin list lives in the env var
 * `SIGNED_CONFIG_PUBLIC_KEYS` (comma-separated raw hex, each 32 bytes).
 *
 * Envelope shape on the wire:
 *   { payload: "<base64url of canonical JSON>", signature: "<base64url Ed25519>" }
 *
 * Canonical payload JSON fields (see `SignedConfigPayload`):
 *   - tenant_id: target org
 *   - action: always "tier_c_admin_flip" at v1
 *   - previous_tier / new_tier: the transition
 *   - issued_at: ISO8601 signing timestamp
 *   - nonce: caller-generated, stored on the policy row to defeat replay
 *   - signer_fingerprint: sha256(pubkey-raw)[:16] in hex; enforced to match
 *     the verifying key so a stolen signed envelope cannot claim a different
 *     signer.
 *
 * Verification only — policy application, cooldown, and audit live in
 * `apps/ingest/src/policy-flip/**`. This module has no DB, no clock beyond
 * payload validation, and no I/O. D20's "7-day cooldown" is enforced at
 * the policy-flip layer, not here — signatures are evergreen.
 */

export interface SignedConfigPayload {
  tenant_id: string;
  action: "tier_c_admin_flip";
  previous_tier: "A" | "B" | "C";
  new_tier: "C";
  issued_at: string;
  nonce: string;
  signer_fingerprint: string;
}

export interface SignedConfigEnvelope {
  payload: string;
  signature: string;
}

export type VerifyResult =
  | { valid: true; payload: SignedConfigPayload; signerFingerprint: string }
  | { valid: false; reason: VerifyFailureReason };

export type VerifyFailureReason =
  | "NO_PUBLIC_KEYS"
  | "MALFORMED_ENVELOPE"
  | "MALFORMED_PAYLOAD"
  | "BAD_SIGNATURE"
  | "FINGERPRINT_MISMATCH"
  | "UNSUPPORTED_ACTION"
  | "INVALID_TIER_TRANSITION"
  | "INVALID_TIMESTAMP";

const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
const MAX_SIGNATURE_AGE_MS = 24 * 60 * 60 * 1000;

function base64UrlDecode(s: string): Uint8Array {
  const padLen = (4 - (s.length % 4)) % 4;
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(padLen);
  return Uint8Array.from(Buffer.from(b64, "base64"));
}

function base64UrlEncode(bytes: Uint8Array): string {
  return Buffer.from(bytes)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function hexDecode(hex: string): Uint8Array {
  if (!/^[0-9a-fA-F]*$/.test(hex) || hex.length % 2 !== 0) {
    throw new Error("invalid hex");
  }
  return Uint8Array.from(Buffer.from(hex, "hex"));
}

function hexEncode(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

/**
 * Parse the `SIGNED_CONFIG_PUBLIC_KEYS` env value into raw 32-byte keys.
 * Empty / missing / whitespace-only entries are filtered. Each non-empty
 * entry must be exactly 64 hex chars (32 bytes); throws on malformed input
 * so misconfiguration surfaces at boot rather than silently rejecting every
 * flip at runtime.
 */
export function parsePublicKeysEnv(raw: string | undefined): Uint8Array[] {
  if (raw === undefined || raw === "") return [];
  const parts = raw
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  const out: Uint8Array[] = [];
  for (const p of parts) {
    const bytes = hexDecode(p);
    if (bytes.byteLength !== 32) {
      throw new Error(
        `SIGNED_CONFIG_PUBLIC_KEYS entry must be 32 bytes (64 hex chars); got ${bytes.byteLength}`,
      );
    }
    out.push(bytes);
  }
  return out;
}

/**
 * sha256(pub-raw).slice(0, 8) rendered as 16 hex chars. Short enough to
 * include in audit rows and log lines without bloating them; long enough
 * to be collision-safe at the scale of one tenant's signer set.
 */
export async function fingerprintPublicKey(pubRaw: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", pubRaw);
  return hexEncode(new Uint8Array(digest).slice(0, 8));
}

function parsePayload(raw: string): SignedConfigPayload | null {
  let bytes: Uint8Array;
  try {
    bytes = base64UrlDecode(raw);
  } catch {
    return null;
  }
  let obj: unknown;
  try {
    obj = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  if (typeof o.tenant_id !== "string" || o.tenant_id.length === 0) return null;
  if (o.action !== "tier_c_admin_flip") return null;
  if (o.previous_tier !== "A" && o.previous_tier !== "B" && o.previous_tier !== "C") return null;
  if (o.new_tier !== "C") return null;
  if (typeof o.issued_at !== "string" || Number.isNaN(Date.parse(o.issued_at))) return null;
  if (typeof o.nonce !== "string" || o.nonce.length === 0) return null;
  if (typeof o.signer_fingerprint !== "string" || !/^[0-9a-f]{16}$/.test(o.signer_fingerprint)) {
    return null;
  }
  return o as unknown as SignedConfigPayload;
}

/**
 * Verify a signed-config envelope against the pinned keyset.
 *
 * Strategy: decode envelope → parse payload → for each pinned public key,
 * attempt Ed25519 verify over the base64url-decoded payload bytes. Accept
 * on the first key whose fingerprint matches `payload.signer_fingerprint`
 * AND whose signature verifies. The fingerprint check happens BEFORE the
 * crypto call so a malicious signer cannot force O(N) verifies per request
 * across the full key set.
 */
export async function verifySignedConfig(
  envelope: unknown,
  publicKeysRaw: Uint8Array[],
  opts: { now?: () => number } = {},
): Promise<VerifyResult> {
  if (publicKeysRaw.length === 0) {
    return { valid: false, reason: "NO_PUBLIC_KEYS" };
  }
  if (
    !envelope ||
    typeof envelope !== "object" ||
    typeof (envelope as { payload?: unknown }).payload !== "string" ||
    typeof (envelope as { signature?: unknown }).signature !== "string"
  ) {
    return { valid: false, reason: "MALFORMED_ENVELOPE" };
  }
  const { payload: payloadB64, signature: sigB64 } = envelope as {
    payload: string;
    signature: string;
  };

  const payload = parsePayload(payloadB64);
  if (payload === null) {
    return { valid: false, reason: "MALFORMED_PAYLOAD" };
  }

  if (payload.action !== "tier_c_admin_flip") {
    return { valid: false, reason: "UNSUPPORTED_ACTION" };
  }
  if (payload.new_tier !== "C" || payload.previous_tier === "C") {
    return { valid: false, reason: "INVALID_TIER_TRANSITION" };
  }

  const issuedAt = Date.parse(payload.issued_at);
  const now = (opts.now ?? Date.now)();
  if (issuedAt > now + MAX_CLOCK_SKEW_MS) {
    return { valid: false, reason: "INVALID_TIMESTAMP" };
  }
  if (now - issuedAt > MAX_SIGNATURE_AGE_MS) {
    return { valid: false, reason: "INVALID_TIMESTAMP" };
  }

  let sig: Uint8Array;
  let payloadBytes: Uint8Array;
  try {
    sig = base64UrlDecode(sigB64);
    payloadBytes = base64UrlDecode(payloadB64);
  } catch {
    return { valid: false, reason: "MALFORMED_ENVELOPE" };
  }
  if (sig.byteLength !== 64) {
    return { valid: false, reason: "BAD_SIGNATURE" };
  }

  let matchedKey: Uint8Array | null = null;
  let matchedFingerprint: string | null = null;
  for (const pk of publicKeysRaw) {
    const fp = await fingerprintPublicKey(pk);
    if (fp === payload.signer_fingerprint) {
      matchedKey = pk;
      matchedFingerprint = fp;
      break;
    }
  }
  if (matchedKey === null || matchedFingerprint === null) {
    return { valid: false, reason: "FINGERPRINT_MISMATCH" };
  }

  const cryptoKey = await crypto.subtle.importKey("raw", matchedKey, { name: "Ed25519" }, false, [
    "verify",
  ]);
  const ok = await crypto.subtle.verify({ name: "Ed25519" }, cryptoKey, sig, payloadBytes);
  if (!ok) {
    return { valid: false, reason: "BAD_SIGNATURE" };
  }
  return { valid: true, payload, signerFingerprint: matchedFingerprint };
}

/**
 * Test-only helper to mint a signed envelope. Production signing happens
 * offline on an admin workstation — never in the ingest process.
 */
export async function signConfig(
  payload: SignedConfigPayload,
  privateKey: CryptoKey,
): Promise<SignedConfigEnvelope> {
  const json = JSON.stringify(payload);
  const payloadBytes = new TextEncoder().encode(json);
  const sig = await crypto.subtle.sign({ name: "Ed25519" }, privateKey, payloadBytes);
  return {
    payload: base64UrlEncode(payloadBytes),
    signature: base64UrlEncode(new Uint8Array(sig)),
  };
}

/** Test helper — generate an Ed25519 keypair and return raw public bytes + CryptoKey. */
export async function generateTestKeypair(): Promise<{
  publicKeyRaw: Uint8Array;
  privateKey: CryptoKey;
}> {
  const kp = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const pubRaw = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
  return { publicKeyRaw: pubRaw, privateKey: kp.privateKey };
}

export const _internals = {
  base64UrlDecode,
  base64UrlEncode,
  hexDecode,
  hexEncode,
  MAX_CLOCK_SKEW_MS,
  MAX_SIGNATURE_AGE_MS,
};
