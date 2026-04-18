// Public surface of the policy-flip module (D20).
//
// Boot wiring (apps/ingest/src/index.ts) calls `parsePublicKeysEnv(...)` and
// constructs `PolicyFlipDeps` with real Drizzle-backed store / audit / alert
// implementations. Tests use the in-memory doubles in this directory.

export { InMemoryAlertEmitter, InMemoryAuditWriter } from "./audit";
export type { CooldownCheck } from "./cooldown";
export { COOLDOWN_WINDOW_MS, checkCooldown } from "./cooldown";
export type { PolicyFlipDeps } from "./handler";
export { handlePolicyFlip } from "./handler";
export { defaultPolicyRow, InMemoryPolicyFlipStore } from "./store";
export type {
  AdminFlipCaller,
  AlertEmitter,
  AlertRow,
  AuditRow,
  AuditWriter,
  PolicyFlipErrorCode,
  PolicyFlipRequest,
  PolicyFlipResult,
  PolicyFlipStore,
  Tier,
  TierCPolicyRow,
} from "./types";
