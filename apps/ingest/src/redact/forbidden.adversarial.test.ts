// MERGE BLOCKER — 100% rejection of forbidden fields on Tier A/B sources.
//
// Per CLAUDE.md §API Rules and contract 08 §Forbidden-field rejection:
// "Server rejects (HTTP 400) any payload containing rawPrompt, prompt_text,
// messages, toolArgs, toolOutputs, fileContents, diffs, filePaths, ticketIds,
// emails, realNames from Tier A/B sources (adversarial fuzzer in CI must hit
// 100%)."
//
// This test fuzzes every forbidden field at multiple nesting depths and
// asserts `enforceTier()` rejects with `code: FORBIDDEN_FIELD` every time.
// Lives in this directory (A6 owns) because redaction and forbidden-field
// rejection are the same privacy gate from the ingest caller's view.

import { describe, expect, test } from "bun:test";
import { FORBIDDEN_FIELDS } from "@bematist/schema";
import { enforceTier, type OrgPolicy } from "../tier/enforceTier";

const POLICY: OrgPolicy = {
  tier_c_managed_cloud_optin: false,
  tier_default: "B",
};

function seedTopLevel(field: string): Record<string, unknown> {
  return {
    tier: "B",
    session_id: "sess_1",
    event_seq: 1,
    [field]: "leak",
  };
}

function seedNested(field: string): Record<string, unknown> {
  return {
    tier: "B",
    session_id: "sess_1",
    event_seq: 1,
    dev_metrics: { event_kind: "llm_request" },
    nested: { deeper: { [field]: "leak" } },
  };
}

function seedArray(field: string): Record<string, unknown> {
  return {
    tier: "B",
    session_id: "sess_1",
    event_seq: 1,
    list: [{ innocent: true }, { [field]: "leak" }],
  };
}

describe("MERGE BLOCKER — forbidden-field rejection 100% on Tier A/B", () => {
  test("contract 08 declares 12 forbidden fields", () => {
    // Contract 08 §Forbidden-field rejection enumerates: rawPrompt, prompt,
    // prompt_text, messages, toolArgs, toolOutputs, fileContents, diffs,
    // filePaths, ticketIds, emails, realNames.
    expect(FORBIDDEN_FIELDS).toHaveLength(12);
  });

  test("every forbidden field at top level is rejected (tier B)", async () => {
    for (const f of FORBIDDEN_FIELDS) {
      const res = await enforceTier(seedTopLevel(f), { tier: "B", tenantId: "org_x" }, POLICY);
      expect(res.reject).toBe(true);
      if (res.reject) {
        expect(res.code).toBe("FORBIDDEN_FIELD");
        expect(res.status).toBe(400);
        expect(res.field).toBe(f);
      }
    }
  });

  test("every forbidden field at nested depth is rejected (tier B)", async () => {
    for (const f of FORBIDDEN_FIELDS) {
      const res = await enforceTier(seedNested(f), { tier: "B", tenantId: "org_x" }, POLICY);
      expect(res.reject).toBe(true);
      if (res.reject) expect(res.code).toBe("FORBIDDEN_FIELD");
    }
  });

  test("every forbidden field inside an array element is rejected (tier B)", async () => {
    for (const f of FORBIDDEN_FIELDS) {
      const res = await enforceTier(seedArray(f), { tier: "B", tenantId: "org_x" }, POLICY);
      expect(res.reject).toBe(true);
      if (res.reject) expect(res.code).toBe("FORBIDDEN_FIELD");
    }
  });

  test("every forbidden field at top level is rejected (tier A)", async () => {
    for (const f of FORBIDDEN_FIELDS) {
      const ev = seedTopLevel(f);
      ev.tier = "A";
      const res = await enforceTier(ev, { tier: "A", tenantId: "org_x" }, POLICY);
      expect(res.reject).toBe(true);
      if (res.reject) expect(res.code).toBe("FORBIDDEN_FIELD");
    }
  });

  test("Tier-C events are NOT rejected for known Tier-C content fields", async () => {
    // prompt_text is a forbidden wire field for Tier A/B, but a legitimate
    // field for Tier C (server redacts at ingest). enforceTier returns
    // {reject: false} so the downstream redact pipeline can scan.
    const cPolicy: OrgPolicy = { tier_c_managed_cloud_optin: true, tier_default: "C" };
    const ev = { tier: "C", session_id: "s", event_seq: 1, prompt_text: "hello" };
    const res = await enforceTier(ev, { tier: "C", tenantId: "org_x" }, cPolicy);
    expect(res.reject).toBe(false);
  });
});
