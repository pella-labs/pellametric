// Sprint 1: re-export the real verifier from ./auth/verifyIngestKey.
// Contract: `Authorization: Bearer bm_<orgId>_<keyId>_<secret>` (three segments)
// is an ingest-key verified via timingSafeEqual against sha256(secret) stored in
// Postgres `ingest_keys` with a 60s LRU cache. Legacy 2-segment form is accepted
// for dev-mode store lookups. See contracts/02-ingest-api.md §Changelog and D-S1-1.

export type {
  AuthContext,
  IngestKeyRow,
  IngestKeyStore,
  Tier,
} from "./auth/verifyIngestKey";
export { LRUCache, parseBearer, verifyBearer } from "./auth/verifyIngestKey";
