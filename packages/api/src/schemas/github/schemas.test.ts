// G2-admin-apis schema unit tests. These gate the Zod schemas — the
// single source of truth for Server Actions + Route Handlers + CLI types
// (CLAUDE.md §API Rules).

import { describe, expect, test } from "bun:test";
import { REDELIVER_WINDOW_DAYS, RedeliverWebhooksInput } from "./redeliver";
import { PatchRepoTrackingInput, PatchTrackingModeInput, TrackingPreviewInput } from "./tracking";
import { ROTATION_WINDOW_MINUTES, RotateWebhookSecretInput } from "./webhookSecret";

describe("PatchTrackingModeInput", () => {
  test("accepts 'all' and 'selected'", () => {
    expect(PatchTrackingModeInput.parse({ mode: "all" }).mode).toBe("all");
    expect(PatchTrackingModeInput.parse({ mode: "selected" }).mode).toBe("selected");
  });
  test("rejects unknown mode", () => {
    expect(() => PatchTrackingModeInput.parse({ mode: "bogus" })).toThrow();
  });
  test("rejects missing mode", () => {
    expect(() => PatchTrackingModeInput.parse({})).toThrow();
  });
});

describe("PatchRepoTrackingInput", () => {
  test("accepts numeric provider_repo_id + valid state", () => {
    const out = PatchRepoTrackingInput.parse({ provider_repo_id: "12345", state: "included" });
    expect(out.provider_repo_id).toBe("12345");
    expect(out.state).toBe("included");
  });
  test("rejects non-numeric provider_repo_id", () => {
    expect(() =>
      PatchRepoTrackingInput.parse({ provider_repo_id: "abc", state: "included" }),
    ).toThrow();
  });
  test("rejects unknown state", () => {
    expect(() =>
      PatchRepoTrackingInput.parse({ provider_repo_id: "12345", state: "bogus" }),
    ).toThrow();
  });
});

describe("TrackingPreviewInput", () => {
  test("parses mode + splits + filters included_repos", () => {
    const out = TrackingPreviewInput.parse({
      mode: "selected",
      included_repos: "111,222,bogus, 333 , ,444",
    });
    expect(out.mode).toBe("selected");
    expect(out.included_repos).toEqual(["111", "222", "333", "444"]);
  });
  test("empty included_repos defaults to []", () => {
    const out = TrackingPreviewInput.parse({ mode: "all" });
    expect(out.included_repos).toEqual([]);
  });
  test("rejects invalid mode", () => {
    expect(() => TrackingPreviewInput.parse({ mode: "bogus", included_repos: "" })).toThrow();
  });
});

describe("RotateWebhookSecretInput", () => {
  test("accepts valid ref", () => {
    const out = RotateWebhookSecretInput.parse({ new_secret_ref: "sm/foo:bar_v2" });
    expect(out.new_secret_ref).toBe("sm/foo:bar_v2");
  });
  test("rejects whitespace in ref", () => {
    expect(() => RotateWebhookSecretInput.parse({ new_secret_ref: "has space" })).toThrow();
  });
  test("rejects empty ref", () => {
    expect(() => RotateWebhookSecretInput.parse({ new_secret_ref: "" })).toThrow();
  });
  test("rejects ref > 255", () => {
    expect(() => RotateWebhookSecretInput.parse({ new_secret_ref: "x".repeat(256) })).toThrow();
  });
  test("ROTATION_WINDOW_MINUTES is 10", () => {
    expect(ROTATION_WINDOW_MINUTES).toBe(10);
  });
});

describe("RedeliverWebhooksInput", () => {
  const baseFrom = "2026-04-10T00:00:00.000Z";
  const baseTo = "2026-04-11T00:00:00.000Z";

  test("accepts minimal body with from/to", () => {
    const out = RedeliverWebhooksInput.parse({ from: baseFrom, to: baseTo });
    expect(out.from).toBe(baseFrom);
    expect(out.to).toBe(baseTo);
  });
  test("accepts event_types filter", () => {
    const out = RedeliverWebhooksInput.parse({
      from: baseFrom,
      to: baseTo,
      event_types: ["pull_request", "push"],
    });
    expect(out.event_types).toEqual(["pull_request", "push"]);
  });
  test("rejects event_type with hyphen", () => {
    expect(() =>
      RedeliverWebhooksInput.parse({
        from: baseFrom,
        to: baseTo,
        event_types: ["pull-request"],
      }),
    ).toThrow();
  });
  test("rejects when from >= to", () => {
    expect(() => RedeliverWebhooksInput.parse({ from: baseTo, to: baseFrom })).toThrow();
    expect(() => RedeliverWebhooksInput.parse({ from: baseFrom, to: baseFrom })).toThrow();
  });
  test("rejects window > 7 days", () => {
    const far = "2026-04-20T00:00:01.000Z"; // >7d after baseFrom
    expect(() => RedeliverWebhooksInput.parse({ from: baseFrom, to: far })).toThrow();
  });
  test("accepts window exactly at 7-day boundary", () => {
    const seven = new Date(
      new Date(baseFrom).getTime() + REDELIVER_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();
    expect(() => RedeliverWebhooksInput.parse({ from: baseFrom, to: seven })).not.toThrow();
  });
});
