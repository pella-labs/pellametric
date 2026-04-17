import type { Database } from "bun:sqlite";
import type { Event } from "@bematist/schema";

export interface PendingRow {
  client_event_id: string;
  body_json: string;
  enqueued_at: string;
  retry_count: number;
  last_error: string | null;
}

export class Journal {
  constructor(private readonly db: Database) {}

  enqueue(event: Event): void {
    this.db.run(
      `INSERT OR IGNORE INTO events (client_event_id, body_json, enqueued_at)
       VALUES (?, ?, ?)`,
      [event.client_event_id, JSON.stringify(event), new Date().toISOString()],
    );
  }

  selectPending(limit: number): PendingRow[] {
    return this.db
      .query<PendingRow, [number]>(
        `SELECT client_event_id, body_json, enqueued_at, retry_count, last_error
         FROM events WHERE submitted_at IS NULL
         ORDER BY enqueued_at ASC LIMIT ?`,
      )
      .all(limit);
  }

  markSubmitted(ids: string[]): void {
    if (ids.length === 0) return;
    const now = new Date().toISOString();
    const stmt = this.db.prepare(
      "UPDATE events SET submitted_at = ?, last_error = NULL WHERE client_event_id = ?",
    );
    this.db.transaction(() => {
      for (const id of ids) stmt.run(now, id);
    })();
  }

  markFailed(ids: string[], lastError: string): void {
    if (ids.length === 0) return;
    const stmt = this.db.prepare(
      `UPDATE events SET retry_count = retry_count + 1, last_error = ?
       WHERE client_event_id = ?`,
    );
    this.db.transaction(() => {
      for (const id of ids) stmt.run(lastError, id);
    })();
  }

  pendingCount(): number {
    return (
      this.db
        .query<{ c: number }, []>("SELECT COUNT(*) AS c FROM events WHERE submitted_at IS NULL")
        .get()?.c ?? 0
    );
  }

  tail(limit: number): Array<PendingRow & { submitted_at: string | null }> {
    return this.db
      .query<PendingRow & { submitted_at: string | null }, [number]>(
        `SELECT client_event_id, body_json, enqueued_at, retry_count, last_error, submitted_at
         FROM events ORDER BY enqueued_at DESC LIMIT ?`,
      )
      .all(limit);
  }
}
