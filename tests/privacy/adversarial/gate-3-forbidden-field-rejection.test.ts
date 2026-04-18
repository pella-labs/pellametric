// Gate 3 / 5 — forbidden-field rejection 100% on Tier A/B sources.
//
// MERGE BLOCKER per CLAUDE.md §API Rules and dev-docs/m2-gate-agent-team.md §A16.
//
// Two complementary checks:
//   3a. The 12 forbidden fields × {top-level, nested, array} × {tier A, tier B}
//       combinations all return `{reject:true, status:400, code:"FORBIDDEN_FIELD"}`
//       from `enforceTier()`. 12 × 3 × 2 = 72 cases — the suite asserts every
//       single one rejects, with no statistical sampling.
//   3b. Tier-C events with the same field on an opted-in org pass enforceTier
//       (they go on to redaction, which scrubs the value). This is the precision
//       check — guards against an over-eager fuzz that breaks legitimate Tier-C.
//
// Source of truth for the field list: `@bematist/schema` `FORBIDDEN_FIELDS`.
// Source of truth for the enforcer: `apps/ingest/src/tier/enforceTier`.

import { describe, expect, test } from "bun:test";
import { FORBIDDEN_FIELDS } from "@bematist/schema";
import { enforceTier, type OrgPolicy } from "../../../apps/ingest/src/tier/enforceTier";

const TIER_AB_POLICY: OrgPolicy = {
  tier_c_managed_cloud_optin: false,
  tier_default: "B",
};

const TIER_C_POLICY: OrgPolicy = {
  tier_c_managed_cloud_optin: true,
  tier_default: "C",
};

const SHAPES = {
  topLevel: (f: string, tier: "A" | "B"): Record<string, unknown> => ({
    tier,
    session_id: "sess_1",
    event_seq: 1,
    [f]: "leak",
  }),
  nested: (f: string, tier: "A" | "B"): Record<string, unknown> => ({
    tier,
    session_id: "sess_1",
    event_seq: 1,
    dev_metrics: { event_kind: "llm_request" },
    nested: { deeper: { [f]: "leak" } },
  }),
  array: (f: string, tier: "A" | "B"): Record<string, unknown> => ({
    tier,
    session_id: "sess_1",
    event_seq: 1,
    list: [{ ok: true }, { [f]: "leak" }],
  }),
} as const;

describe("PRIVACY GATE 3/5 — forbidden-field rejection 100% on Tier A/B", () => {
  test("contract 08 declares 12 forbidden fields (drift guard)", () => {
    expect(FORBIDDEN_FIELDS).toHaveLength(12);
  });

  for (const tier of ["A", "B"] as const) {
    for (const shapeName of Object.keys(SHAPES) as Array<keyof typeof SHAPES>) {
      test(`tier ${tier} × ${shapeName} → reject 400 FORBIDDEN_FIELD for every field`, async () => {
        const failures: string[] = [];
        for (const field of FORBIDDEN_FIELDS) {
          const ev = SHAPES[shapeName](field, tier);
          const res = await enforceTier(ev, { tier, tenantId: "org_x" }, TIER_AB_POLICY);
          if (
            !res.reject ||
            res.code !== "FORBIDDEN_FIELD" ||
            res.status !== 400 ||
            res.field !== field
          ) {
            failures.push(`${field}@${shapeName}/${tier}: ${JSON.stringify(res)}`);
          }
        }
        if (failures.length > 0) {
          console.error(`[privacy-gate-3] forbidden-field leaks: ${failures.join(" | ")}`);
        }
        expect(failures).toEqual([]);
      });
    }
  }

  test("Tier-C with prompt_text on an opted-in org is NOT rejected (precision check)", async () => {
    // Defense-in-depth: the redactor scrubs prompt_text for Tier-C; rejection
    // here would block the only legitimate path to that content.
    const res = await enforceTier(
      { tier: "C", session_id: "s", event_seq: 1, prompt_text: "anything" },
      { tier: "C", tenantId: "org_y" },
      TIER_C_POLICY,
    );
    expect(res.reject).toBe(false);
  });

  test("Tier-C without opt-in is rejected 403 TIER_C_NOT_OPTED_IN", async () => {
    // Layered guard — even before redaction, Tier-C content from an org that
    // hasn't opted into managed-cloud is hard-rejected.
    const res = await enforceTier(
      { tier: "C", session_id: "s", event_seq: 1, prompt_text: "anything" },
      { tier: "C", tenantId: "org_z" },
      TIER_AB_POLICY,
    );
    expect(res.reject).toBe(true);
    if (res.reject) {
      expect(res.status).toBe(403);
      expect(res.code).toBe("TIER_C_NOT_OPTED_IN");
    }
  });
});
