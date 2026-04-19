import type { Database } from "bun:sqlite";
import type { CursorStore } from "@bematist/sdk";

export class SqliteCursorStore implements CursorStore {
  constructor(
    private readonly db: Database,
    private readonly adapterId: string,
  ) {}

  async get(key: string): Promise<string | null> {
    const row = this.db
      .query<{ value: string }, [string, string]>(
        "SELECT value FROM cursors WHERE adapter_id = ? AND key = ?",
      )
      .get(this.adapterId, key);
    return row?.value ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    this.db.run(
      `INSERT INTO cursors (adapter_id, key, value, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(adapter_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [this.adapterId, key, value, new Date().toISOString()],
    );
  }

  /**
   * Atomically upsert many (key, value) pairs under this adapter_id.
   *
   * Wraps all writes in a single `bun:sqlite` transaction — if any statement
   * throws, the whole batch rolls back and no cursor advances. This is the
   * required primitive for adapters that tail multiple correlated files (e.g.
   * Continue.dev's four JSONL streams): without it, a mid-flush crash or
   * disk-full error can leave cursors divergent, so the next poll re-tails
   * some streams while others continue normally, breaking `event_seq`
   * ordering per stream.
   *
   * An empty `entries` array is a no-op (no transaction is opened).
   */
  async setMany(entries: ReadonlyArray<{ key: string; value: string }>): Promise<void> {
    if (entries.length === 0) return;
    const stmt = this.db.prepare(
      `INSERT INTO cursors (adapter_id, key, value, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(adapter_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    );
    const now = new Date().toISOString();
    const tx = this.db.transaction((rows: ReadonlyArray<{ key: string; value: string }>) => {
      for (const r of rows) {
        stmt.run(this.adapterId, r.key, r.value, now);
      }
    });
    tx(entries);
  }
}
