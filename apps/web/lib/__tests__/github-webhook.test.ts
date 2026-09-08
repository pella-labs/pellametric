import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { verifyWebhookSignature, parseEventName } from "@/lib/github-webhook";

describe("verifyWebhookSignature", () => {
  it("verifies a correct HMAC-SHA256 signature", () => {
    const secret = "swordfish";
    const body = '{"hello":"world"}';
    const mac = createHmac("sha256", secret).update(body).digest("hex");
    expect(verifyWebhookSignature(body, `sha256=${mac}`, secret)).toBe(true);
  });

  it("rejects mismatched signature", () => {
    expect(verifyWebhookSignature("body", "sha256=deadbeef", "swordfish")).toBe(false);
  });

  it("rejects missing prefix", () => {
    expect(verifyWebhookSignature("body", "deadbeef", "swordfish")).toBe(false);
  });

  it("rejects empty secret", () => {
    expect(verifyWebhookSignature("body", "sha256=anything", "")).toBe(false);
  });
});

describe("parseEventName", () => {
  it("accepts known events", () => {
    expect(parseEventName("pull_request")).toBe("pull_request");
    expect(parseEventName("push")).toBe("push");
    expect(parseEventName("ping")).toBe("ping");
  });
  it("rejects unknown events", () => {
    expect(parseEventName("issue_comment")).toBe(null);
    expect(parseEventName(null)).toBe(null);
  });
});
