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
}
