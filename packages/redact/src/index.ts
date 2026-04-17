// Bematist — @bematist/redact.
//
// Sprint 1 Phase 2 surfaces:
//   - RedactStage interface + noopRedactStage (stage.ts) — seam for Sprint 2
//     TruffleHog + Gitleaks + Presidio pipeline (contract 08).
//   - TIER_A_RAW_ATTRS_ALLOWLIST + filterRawAttrs (tier_a_allowlist.ts) —
//     enforced at ingest when ENFORCE_TIER_A_ALLOWLIST=1.
//
// CLAUDE.md §Security Rules: "server-side secret redaction is mandatory"; the
// real stages land in Sprint 2, this package ships the contract only.

export * from "./stage";
export * from "./tier_a_allowlist";
