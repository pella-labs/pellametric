// Drizzle-backed AuditWriter for D20 tier-C admin flips.
// Inserts an append-only row in `audit_log` with the shape enforced by
// handler.ts#makeAuditRow — action="tier_c_admin_flip", target_type="policy",
// target_id=org_id, and a metadata_json payload carrying the signer
// fingerprint, prev/new tier, nonce, issued_at, request_id.
//
// The DB-level trigger `audit_log_immutable` (custom/0001) rejects UPDATE /
// DELETE; no insert-if-exists logic here. If an ingest retry lands a second
// POST with the same nonce, production deploys should add a unique index on
// (target_id, (metadata_json->>'nonce')) per handler.ts §24.

import { audit_log } from "@bematist/schema/postgres";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { AuditRow, AuditWriter } from "./types";

export interface DrizzleAuditWriterDeps {
  db: PostgresJsDatabase<Record<string, unknown>>;
}

export class DrizzleAuditWriter implements AuditWriter {
  constructor(private readonly deps: DrizzleAuditWriterDeps) {}

  async write(row: AuditRow): Promise<void> {
    await this.deps.db.insert(audit_log).values({
      ts: row.ts,
      org_id: row.org_id,
      actor_user_id: row.actor_user_id,
      action: row.action,
      target_type: row.target_type,
      target_id: row.target_id,
      reason: row.reason,
      metadata_json: row.metadata_json,
    });
  }
}
