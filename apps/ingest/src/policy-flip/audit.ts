// In-memory AuditWriter + AlertEmitter for tests and dev. Production wiring
// in `apps/ingest/src/index.ts` swaps these for `audit_log` / `alerts`
// Drizzle inserts (Postgres) plus an SSE bus publish.

import type { AlertEmitter, AlertRow, AuditRow, AuditWriter } from "./types";

export class InMemoryAuditWriter implements AuditWriter {
  readonly rows: AuditRow[] = [];
  async write(row: AuditRow): Promise<void> {
    this.rows.push({
      ...row,
      metadata_json: { ...row.metadata_json },
    });
  }
  clear(): void {
    this.rows.length = 0;
  }
}

export class InMemoryAlertEmitter implements AlertEmitter {
  readonly rows: AlertRow[] = [];
  async emit(row: AlertRow): Promise<void> {
    this.rows.push({ ...row });
  }
  clear(): void {
    this.rows.length = 0;
  }
}
