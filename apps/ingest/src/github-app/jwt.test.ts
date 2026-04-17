import { describe, expect, test } from "bun:test";
import { createVerify, generateKeyPairSync } from "node:crypto";
import { base64url, mintAppJwt } from "./jwt";

function b64urlToBuf(s: string): Buffer {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

describe("github-app/jwt", () => {
  test("mintAppJwt produces RS256 JWT with expected claims and verifiable signature", () => {
    const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const privateKeyPem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
    const publicKeyPem = publicKey.export({ format: "pem", type: "spki" }).toString();
    const fixedNow = 1_700_000_000_000;
    const jwt = mintAppJwt({
      appId: 42,
      privateKeyPem,
      now: () => fixedNow,
    });
    const parts = jwt.split(".");
    expect(parts.length).toBe(3);
    const [h, p, s] = parts as [string, string, string];
    const header = JSON.parse(b64urlToBuf(h).toString("utf8"));
    const payload = JSON.parse(b64urlToBuf(p).toString("utf8"));
    expect(header.alg).toBe("RS256");
    expect(header.typ).toBe("JWT");
    expect(payload.iss).toBe(42);
    const nowSec = Math.floor(fixedNow / 1000);
    expect(payload.iat).toBe(nowSec - 60);
    expect(payload.exp).toBe(nowSec + 9 * 60);
    const signingInput = `${h}.${p}`;
    const sig = b64urlToBuf(s);
    const verifier = createVerify("RSA-SHA256");
    verifier.update(signingInput);
    verifier.end();
    expect(verifier.verify(publicKeyPem, sig)).toBe(true);
  });

  test("base64url strips padding and uses -_ alphabet", () => {
    const s = base64url("ab?>");
    expect(s.includes("=")).toBe(false);
    expect(s.includes("+")).toBe(false);
    expect(s.includes("/")).toBe(false);
  });
});
