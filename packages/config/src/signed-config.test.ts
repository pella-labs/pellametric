import { describe, expect, test } from "bun:test";
import {
  fingerprintPublicKey,
  generateTestKeypair,
  parsePublicKeysEnv,
  type SignedConfigPayload,
  signConfig,
  verifySignedConfig,
} from "./signed-config";

const FIXED_NOW = Date.parse("2026-04-17T12:00:00.000Z");
const fixedClock = () => FIXED_NOW;

async function makeValidPayload(
  override: Partial<SignedConfigPayload> = {},
  pubRaw?: Uint8Array,
): Promise<SignedConfigPayload> {
  const base: SignedConfigPayload = {
    tenant_id: "00000000-0000-4000-8000-000000000001",
    action: "tier_c_admin_flip",
    previous_tier: "B",
    new_tier: "C",
    issued_at: new Date(FIXED_NOW - 60_000).toISOString(),
    nonce: "nonce-1",
    signer_fingerprint: pubRaw ? await fingerprintPublicKey(pubRaw) : "0".repeat(16),
    ...override,
  };
  return base;
}

function hex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

describe("parsePublicKeysEnv", () => {
  test("returns empty array for missing/empty env", () => {
    expect(parsePublicKeysEnv(undefined)).toEqual([]);
    expect(parsePublicKeysEnv("")).toEqual([]);
  });

  test("parses single 32-byte hex key", () => {
    const k = "11".repeat(32);
    const out = parsePublicKeysEnv(k);
    expect(out).toHaveLength(1);
    expect(out[0]?.byteLength).toBe(32);
  });

  test("parses comma-separated keys with whitespace", () => {
    const a = "aa".repeat(32);
    const b = "bb".repeat(32);
    const out = parsePublicKeysEnv(` ${a} , ${b} `);
    expect(out).toHaveLength(2);
  });

  test("throws on wrong-length hex", () => {
    expect(() => parsePublicKeysEnv("11".repeat(31))).toThrow();
  });

  test("throws on non-hex chars", () => {
    expect(() => parsePublicKeysEnv("zz".repeat(32))).toThrow();
  });
});

describe("fingerprintPublicKey", () => {
  test("16 hex chars, deterministic", async () => {
    const pub = new Uint8Array(32).fill(7);
    const fp1 = await fingerprintPublicKey(pub);
    const fp2 = await fingerprintPublicKey(pub);
    expect(fp1).toBe(fp2);
    expect(fp1).toMatch(/^[0-9a-f]{16}$/);
  });

  test("different inputs produce different fingerprints", async () => {
    const a = new Uint8Array(32).fill(1);
    const b = new Uint8Array(32).fill(2);
    expect(await fingerprintPublicKey(a)).not.toBe(await fingerprintPublicKey(b));
  });
});

describe("verifySignedConfig — happy path", () => {
  test("valid signature from pinned key → accept", async () => {
    const { publicKeyRaw, privateKey } = await generateTestKeypair();
    const payload = await makeValidPayload({}, publicKeyRaw);
    const env = await signConfig(payload, privateKey);
    const res = await verifySignedConfig(env, [publicKeyRaw], { now: fixedClock });
    expect(res.valid).toBe(true);
    if (res.valid) {
      expect(res.payload).toEqual(payload);
      expect(res.signerFingerprint).toBe(await fingerprintPublicKey(publicKeyRaw));
    }
  });

  test("valid signature with multi-key keyset (correct key second) → accept", async () => {
    const wrongKp = await generateTestKeypair();
    const goodKp = await generateTestKeypair();
    const payload = await makeValidPayload({}, goodKp.publicKeyRaw);
    const env = await signConfig(payload, goodKp.privateKey);
    const res = await verifySignedConfig(env, [wrongKp.publicKeyRaw, goodKp.publicKeyRaw], {
      now: fixedClock,
    });
    expect(res.valid).toBe(true);
  });
});

describe("verifySignedConfig — rejection paths", () => {
  test("empty pinned keyset → NO_PUBLIC_KEYS", async () => {
    const { publicKeyRaw, privateKey } = await generateTestKeypair();
    const payload = await makeValidPayload({}, publicKeyRaw);
    const env = await signConfig(payload, privateKey);
    const res = await verifySignedConfig(env, [], { now: fixedClock });
    expect(res).toEqual({ valid: false, reason: "NO_PUBLIC_KEYS" });
  });

  test("malformed envelope (missing signature) → MALFORMED_ENVELOPE", async () => {
    const { publicKeyRaw } = await generateTestKeypair();
    const res = await verifySignedConfig({ payload: "abc" }, [publicKeyRaw], { now: fixedClock });
    expect(res).toEqual({ valid: false, reason: "MALFORMED_ENVELOPE" });
  });

  test("non-object envelope → MALFORMED_ENVELOPE", async () => {
    const { publicKeyRaw } = await generateTestKeypair();
    const res = await verifySignedConfig("not-an-object", [publicKeyRaw], { now: fixedClock });
    expect(res).toEqual({ valid: false, reason: "MALFORMED_ENVELOPE" });
  });

  test("malformed payload (not JSON) → MALFORMED_PAYLOAD", async () => {
    const { publicKeyRaw } = await generateTestKeypair();
    const env = {
      payload: Buffer.from("not json").toString("base64url"),
      signature: Buffer.from(new Uint8Array(64)).toString("base64url"),
    };
    const res = await verifySignedConfig(env, [publicKeyRaw], { now: fixedClock });
    expect(res).toEqual({ valid: false, reason: "MALFORMED_PAYLOAD" });
  });

  test("payload missing tenant_id → MALFORMED_PAYLOAD", async () => {
    const { publicKeyRaw, privateKey } = await generateTestKeypair();
    const bad = { ...(await makeValidPayload({}, publicKeyRaw)), tenant_id: "" };
    const env = await signConfig(bad as SignedConfigPayload, privateKey);
    const res = await verifySignedConfig(env, [publicKeyRaw], { now: fixedClock });
    expect(res).toEqual({ valid: false, reason: "MALFORMED_PAYLOAD" });
  });

  test("payload with non-C new_tier → MALFORMED_PAYLOAD (parsing rejects shape)", async () => {
    const { publicKeyRaw, privateKey } = await generateTestKeypair();
    const bad = { ...(await makeValidPayload({}, publicKeyRaw)), new_tier: "B" };
    const env = await signConfig(bad as unknown as SignedConfigPayload, privateKey);
    const res = await verifySignedConfig(env, [publicKeyRaw], { now: fixedClock });
    expect(res).toEqual({ valid: false, reason: "MALFORMED_PAYLOAD" });
  });

  test("tampered payload → BAD_SIGNATURE (sig was made over original)", async () => {
    const { publicKeyRaw, privateKey } = await generateTestKeypair();
    const original = await makeValidPayload({}, publicKeyRaw);
    const env = await signConfig(original, privateKey);
    // Re-encode a different valid-shape payload but keep the original signature.
    const tamperedPayload = await makeValidPayload(
      { tenant_id: "00000000-0000-4000-8000-000000000999" },
      publicKeyRaw,
    );
    const tamperedJson = JSON.stringify(tamperedPayload);
    const tamperedB64 = Buffer.from(tamperedJson).toString("base64url");
    const tamperedEnv = { payload: tamperedB64, signature: env.signature };
    const res = await verifySignedConfig(tamperedEnv, [publicKeyRaw], { now: fixedClock });
    expect(res.valid).toBe(false);
    if (!res.valid) expect(res.reason).toBe("BAD_SIGNATURE");
  });

  test("signature from a different key → FINGERPRINT_MISMATCH", async () => {
    const attackerKp = await generateTestKeypair();
    const pinnedKp = await generateTestKeypair();
    // Attacker signs but claims pinned signer's fingerprint? No — attacker
    // doesn't know which fingerprint to forge. Realistic case: attacker signs
    // with own key + uses own fingerprint; pinned set doesn't contain attacker.
    const payload = await makeValidPayload({}, attackerKp.publicKeyRaw);
    const env = await signConfig(payload, attackerKp.privateKey);
    const res = await verifySignedConfig(env, [pinnedKp.publicKeyRaw], { now: fixedClock });
    expect(res).toEqual({ valid: false, reason: "FINGERPRINT_MISMATCH" });
  });

  test("attacker forges fingerprint of pinned key but uses own private key → BAD_SIGNATURE", async () => {
    const attackerKp = await generateTestKeypair();
    const pinnedKp = await generateTestKeypair();
    const pinnedFp = await fingerprintPublicKey(pinnedKp.publicKeyRaw);
    const payload = await makeValidPayload({ signer_fingerprint: pinnedFp });
    const env = await signConfig(payload, attackerKp.privateKey);
    const res = await verifySignedConfig(env, [pinnedKp.publicKeyRaw], { now: fixedClock });
    expect(res.valid).toBe(false);
    if (!res.valid) expect(res.reason).toBe("BAD_SIGNATURE");
  });

  test("signature length not 64 bytes → BAD_SIGNATURE", async () => {
    const { publicKeyRaw, privateKey } = await generateTestKeypair();
    const payload = await makeValidPayload({}, publicKeyRaw);
    const env = await signConfig(payload, privateKey);
    const truncated = {
      payload: env.payload,
      signature: Buffer.from(new Uint8Array(32)).toString("base64url"),
    };
    const res = await verifySignedConfig(truncated, [publicKeyRaw], { now: fixedClock });
    expect(res.valid).toBe(false);
    if (!res.valid) expect(res.reason).toBe("BAD_SIGNATURE");
  });

  test("future-dated payload beyond clock skew → INVALID_TIMESTAMP", async () => {
    const { publicKeyRaw, privateKey } = await generateTestKeypair();
    const payload = await makeValidPayload(
      { issued_at: new Date(FIXED_NOW + 60 * 60 * 1000).toISOString() },
      publicKeyRaw,
    );
    const env = await signConfig(payload, privateKey);
    const res = await verifySignedConfig(env, [publicKeyRaw], { now: fixedClock });
    expect(res).toEqual({ valid: false, reason: "INVALID_TIMESTAMP" });
  });

  test("stale payload older than 24h → INVALID_TIMESTAMP", async () => {
    const { publicKeyRaw, privateKey } = await generateTestKeypair();
    const payload = await makeValidPayload(
      { issued_at: new Date(FIXED_NOW - 25 * 60 * 60 * 1000).toISOString() },
      publicKeyRaw,
    );
    const env = await signConfig(payload, privateKey);
    const res = await verifySignedConfig(env, [publicKeyRaw], { now: fixedClock });
    expect(res).toEqual({ valid: false, reason: "INVALID_TIMESTAMP" });
  });
});

describe("end-to-end env-driven flow", () => {
  test("parse env → verify roundtrip", async () => {
    const { publicKeyRaw, privateKey } = await generateTestKeypair();
    const env = `${hex(publicKeyRaw)}, ${hex(new Uint8Array(32).fill(1))}`;
    const keys = parsePublicKeysEnv(env);
    const payload = await makeValidPayload({}, publicKeyRaw);
    const envelope = await signConfig(payload, privateKey);
    const res = await verifySignedConfig(envelope, keys, { now: fixedClock });
    expect(res.valid).toBe(true);
  });
});
