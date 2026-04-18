// Bematist — @bematist/redact.
//
// Sprint 2 surfaces:
//   - RedactStage interface + noopRedactStage (stage.ts) — used by tests as a
//     pass-through; production wiring uses defaultRedactionStage.
//   - TIER_A_RAW_ATTRS_ALLOWLIST + filterRawAttrs (tier_a_allowlist.ts) —
//     enforced at ingest when ENFORCE_TIER_A_ALLOWLIST=1; also called by the
//     orchestrator post-scan for Tier-A inputs.
//   - createRedactionStage / defaultRedactionStage (orchestrator.ts) — the
//     synchronous TruffleHog + Gitleaks + Presidio pipeline per contract 08.
//   - engines/* — individual rule sets (importable for tests / Clio).
//
// CLAUDE.md §Security Rules: "server-side secret redaction is mandatory" and
// "server is authoritative — rules update without redeploying every dev's
// collector." This package is the single source of redaction code; both the
// ingest hot path (apps/ingest/src/redact/hotpath.ts) and the on-device Clio
// pipeline (packages/clio) import from here.

export { gitleaksEngine, presidioEngine, trufflehogEngine } from "./engines";
export type { Engine, Find } from "./engines/types";
export * from "./orchestrator";
export * from "./stage";
export * from "./tier_a_allowlist";
