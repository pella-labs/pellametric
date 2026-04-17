import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { verifiers, type WebhookDelivery } from "./verify";

function hex(buf: Buffer): string {
  return buf.toString("hex");
}

function bodyBytes(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function githubDelivery(body: string, sig: string): WebhookDelivery {
  return {
    source: "github",
    deliveryId: "abc",
    event: "pull_request",
    rawBody: bodyBytes(body),
    signature: sig,
  };
}

const SECRET = Buffer.from("s3cr3t");

describe("webhooks/verify — GitHub HMAC-SHA256", () => {
  test("valid HMAC → true", () => {
    const body = '{"pull_request":{"number":1}}';
    const mac = hex(createHmac("sha256", SECRET).update(body).digest());
    const d = githubDelivery(body, `sha256=${mac}`);
    expect(verifiers.github.verify(d, SECRET)).toBe(true);
  });

  test("wrong HMAC → false", () => {
    const body = '{"pull_request":{"number":1}}';
    const mac = hex(createHmac("sha256", Buffer.from("other")).update(body).digest());
    const d = githubDelivery(body, `sha256=${mac}`);
    expect(verifiers.github.verify(d, SECRET)).toBe(false);
  });

  test("length-mismatch garbage header (100 bytes) → false, no throw", () => {
    const body = "{}";
    const garbage = `sha256=${"a".repeat(100)}`;
    const d = githubDelivery(body, garbage);
    expect(() => verifiers.github.verify(d, SECRET)).not.toThrow();
    expect(verifiers.github.verify(d, SECRET)).toBe(false);
  });

  test("missing sha256= prefix → false", () => {
    const body = "{}";
    const mac = hex(createHmac("sha256", SECRET).update(body).digest());
    const d = githubDelivery(body, mac); // no prefix
    expect(verifiers.github.verify(d, SECRET)).toBe(false);
  });

  test("raw body preservation: JSON.parse/JSON.stringify round-trip breaks HMAC", () => {
    const original = '{  "pull_request":   {"number":1}   }';
    const mac = hex(createHmac("sha256", SECRET).update(original).digest());
    const reformatted = JSON.stringify(JSON.parse(original));
    const d = githubDelivery(reformatted, `sha256=${mac}`);
    expect(verifiers.github.verify(d, SECRET)).toBe(false);
  });
});

describe("webhooks/verify — GitLab plaintext token + IP allowlist", () => {
  test("valid token + source IP in allowlist → true", () => {
    const d: WebhookDelivery = {
      source: "gitlab",
      deliveryId: "abc",
      event: "merge_request",
      rawBody: bodyBytes("{}"),
      signature: SECRET.toString("utf8"),
      sourceIp: "10.0.0.5",
    };
    expect(verifiers.gitlab.verify(d, SECRET, { allowlistIps: ["10.0.0.5"] })).toBe(true);
  });

  test("valid token + source IP NOT in allowlist → false", () => {
    const d: WebhookDelivery = {
      source: "gitlab",
      deliveryId: "abc",
      event: "merge_request",
      rawBody: bodyBytes("{}"),
      signature: SECRET.toString("utf8"),
      sourceIp: "1.2.3.4",
    };
    expect(verifiers.gitlab.verify(d, SECRET, { allowlistIps: ["10.0.0.5"] })).toBe(false);
  });

  test("valid token + no allowlist → true (dev mode)", () => {
    const d: WebhookDelivery = {
      source: "gitlab",
      deliveryId: "abc",
      event: "merge_request",
      rawBody: bodyBytes("{}"),
      signature: SECRET.toString("utf8"),
    };
    expect(verifiers.gitlab.verify(d, SECRET)).toBe(true);
  });

  test("wrong token → false", () => {
    const d: WebhookDelivery = {
      source: "gitlab",
      deliveryId: "abc",
      event: "merge_request",
      rawBody: bodyBytes("{}"),
      signature: "other-token-length-differs",
    };
    expect(verifiers.gitlab.verify(d, SECRET)).toBe(false);
  });
});

describe("webhooks/verify — Bitbucket HMAC-SHA256 (X-Hub-Signature, no -256 suffix)", () => {
  test("valid Bitbucket HMAC with sha256= prefix → true", () => {
    const body = '{"pullrequest":{"id":1}}';
    const mac = hex(createHmac("sha256", SECRET).update(body).digest());
    const d: WebhookDelivery = {
      source: "bitbucket",
      deliveryId: "req-1",
      event: "pullrequest:created",
      rawBody: bodyBytes(body),
      signature: `sha256=${mac}`,
    };
    expect(verifiers.bitbucket.verify(d, SECRET)).toBe(true);
  });
});
