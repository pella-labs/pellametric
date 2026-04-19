import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import {
  openWelcomeBearer,
  sealWelcomeBearer,
  WELCOME_BEARER_COOKIE_TTL_S,
} from "./welcome-bearer-cookie";

const SECRET = "test-secret-a-long-enough-string-0000000000";

describe("welcome-bearer-cookie — seal + open round-trip", () => {
  test("open recovers the payload from a freshly-sealed cookie", () => {
    const now = 1_700_000_000_000;
    const cookie = sealWelcomeBearer(
      { bearer: "bm_acme_abc123_secret", keyId: "abc123", orgSlug: "acme" },
      SECRET,
      { now, nonce: "nonce1" },
    );
    const opened = openWelcomeBearer(cookie, SECRET, { now });
    expect(opened.ok).toBe(true);
    if (opened.ok) {
      expect(opened.payload.bearer).toBe("bm_acme_abc123_secret");
      expect(opened.payload.keyId).toBe("abc123");
      expect(opened.payload.orgSlug).toBe("acme");
      expect(opened.payload.issuedAt).toBe(now);
      expect(opened.payload.nonce).toBe("nonce1");
    }
  });

  test("empty cookie value → empty", () => {
    expect(openWelcomeBearer(null, SECRET)).toEqual({ ok: false, reason: "empty" });
    expect(openWelcomeBearer("", SECRET)).toEqual({ ok: false, reason: "empty" });
  });
});

describe("welcome-bearer-cookie — tampering detection", () => {
  test("mutated payload → bad_sig", () => {
    const cookie = sealWelcomeBearer({ bearer: "bm_a_1_s", keyId: "1", orgSlug: "a" }, SECRET);
    // Flip a char in the payload half.
    const [payloadB64, sigB64] = cookie.split(".");
    const mutated = `${payloadB64?.slice(0, -1)}X.${sigB64}`;
    expect(openWelcomeBearer(mutated, SECRET).ok).toBe(false);
  });

  test("wrong secret → bad_sig", () => {
    const cookie = sealWelcomeBearer({ bearer: "bm_a_1_s", keyId: "1", orgSlug: "a" }, SECRET);
    const opened = openWelcomeBearer(cookie, "some-other-secret");
    expect(opened).toEqual({ ok: false, reason: "bad_sig" });
  });

  test("missing signature segment → malformed", () => {
    expect(openWelcomeBearer("payloadonly", SECRET)).toEqual({ ok: false, reason: "malformed" });
  });
});

describe("welcome-bearer-cookie — ttl enforcement", () => {
  test("cookie older than TTL → expired", () => {
    const issuedAt = 1_000_000_000_000;
    const cookie = sealWelcomeBearer({ bearer: "bm_a_1_s", keyId: "1", orgSlug: "a" }, SECRET, {
      now: issuedAt,
    });
    const openedFresh = openWelcomeBearer(cookie, SECRET, { now: issuedAt + 10_000 });
    expect(openedFresh.ok).toBe(true);

    const openedStale = openWelcomeBearer(cookie, SECRET, {
      now: issuedAt + (WELCOME_BEARER_COOKIE_TTL_S + 5) * 1000,
    });
    expect(openedStale).toEqual({ ok: false, reason: "expired" });
  });

  test("cookie from the far future → expired (clock skew guard)", () => {
    const now = 2_000_000_000_000;
    const cookie = sealWelcomeBearer({ bearer: "bm_a_1_s", keyId: "1", orgSlug: "a" }, SECRET, {
      now: now + 5 * 60_000,
    });
    const opened = openWelcomeBearer(cookie, SECRET, { now });
    expect(opened).toEqual({ ok: false, reason: "expired" });
  });
});

describe("welcome-bearer-cookie — preconditions", () => {
  test("seal with empty secret throws (programmer error)", () => {
    expect(() => sealWelcomeBearer({ bearer: "bm_a_1_s", keyId: "1", orgSlug: "a" }, "")).toThrow(
      /secret required/,
    );
  });

  test("two seals of the same payload differ by nonce", () => {
    const a = sealWelcomeBearer({ bearer: "bm_a_1_s", keyId: "1", orgSlug: "a" }, SECRET);
    const b = sealWelcomeBearer({ bearer: "bm_a_1_s", keyId: "1", orgSlug: "a" }, SECRET);
    expect(a).not.toBe(b);
  });

  test("payload-shape check rejects unknown JSON", () => {
    // Hand-craft a cookie whose payload is valid JSON but not our shape.
    const fakePayload = Buffer.from(JSON.stringify({ foo: "bar" }), "utf8").toString("base64");
    const b64url = fakePayload.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    // Sign it with the real secret so the bad_sig branch doesn't fire.
    const sig = createHmac("sha256", SECRET).update(b64url).digest();
    const sigB64 = sig
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(openWelcomeBearer(`${b64url}.${sigB64}`, SECRET)).toEqual({
      ok: false,
      reason: "malformed",
    });
  });
});
