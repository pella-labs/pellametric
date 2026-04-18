import { Database } from "bun:sqlite";

/**
 * Build a minimal OpenCode-shaped SQLite database at `path`. Used by the
 * adapter test suite to avoid committing a binary fixture.
 *
 * The schema and field names mirror the subset normalize.ts reads — enough
 * to exercise every event_kind the adapter emits. Mirrors the public sst/
 * opencode Drizzle schema as of v1.2+.
 */
export function buildOpenCodeDb(path: string): void {
  const db = new Database(path);
  try {
    db.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        title TEXT,
        time_created INTEGER NOT NULL,
        time_updated INTEGER NOT NULL
      );
      CREATE TABLE messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        provider_id TEXT,
        model_id TEXT,
        time_created INTEGER NOT NULL,
        input_tokens INTEGER,
        output_tokens INTEGER,
        cache_read_input_tokens INTEGER,
        cache_creation_input_tokens INTEGER,
        cost_usd REAL,
        finish_reason TEXT
      );
      CREATE TABLE parts (
        id TEXT PRIMARY KEY,
        message_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        type TEXT NOT NULL,
        tool_name TEXT,
        tool_call_id TEXT,
        tool_status TEXT,
        tool_duration_ms INTEGER,
        time_created INTEGER NOT NULL
      );
    `);

    // One canonical session covering every event_kind the adapter produces.
    const t0 = Date.parse("2026-04-16T15:00:00.000Z");
    db.run("INSERT INTO sessions (id, title, time_created, time_updated) VALUES (?, ?, ?, ?)", [
      "sess_oc_1",
      "Refactor api handler",
      t0,
      t0 + 14_000,
    ]);

    // user
    db.run(
      `INSERT INTO messages (id, session_id, role, provider_id, model_id, time_created,
        input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens,
        cost_usd, finish_reason)
       VALUES (?, ?, 'user', 'anthropic', 'claude-sonnet-4-5', ?, NULL, NULL, NULL, NULL, NULL, NULL)`,
      ["msg_u1", "sess_oc_1", t0 + 500],
    );

    // assistant turn 1 with tool calls
    db.run(
      `INSERT INTO messages (id, session_id, role, provider_id, model_id, time_created,
        input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens,
        cost_usd, finish_reason)
       VALUES (?, ?, 'assistant', 'anthropic', 'claude-sonnet-4-5', ?, 1800, 305, 1200, 600, 0.00931, 'tool_use')`,
      ["msg_a1", "sess_oc_1", t0 + 3_100],
    );
    db.run(
      `INSERT INTO parts (id, message_id, session_id, type, tool_name, tool_call_id,
        tool_status, tool_duration_ms, time_created)
       VALUES (?, 'msg_a1', 'sess_oc_1', 'tool', 'Read', 'call_1', NULL, NULL, ?)`,
      ["part_t1", t0 + 3_200],
    );
    db.run(
      `INSERT INTO parts (id, message_id, session_id, type, tool_name, tool_call_id,
        tool_status, tool_duration_ms, time_created)
       VALUES (?, 'msg_a1', 'sess_oc_1', 'tool-result', 'Read', 'call_1', 'ok', 130, ?)`,
      ["part_tr1", t0 + 3_400],
    );

    // user follow-up
    db.run(
      `INSERT INTO messages (id, session_id, role, provider_id, model_id, time_created,
        input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens,
        cost_usd, finish_reason)
       VALUES (?, ?, 'user', 'anthropic', 'claude-sonnet-4-5', ?, NULL, NULL, NULL, NULL, NULL, NULL)`,
      ["msg_u2", "sess_oc_1", t0 + 5_000],
    );

    // assistant turn 2 with failing tool
    db.run(
      `INSERT INTO messages (id, session_id, role, provider_id, model_id, time_created,
        input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens,
        cost_usd, finish_reason)
       VALUES (?, ?, 'assistant', 'anthropic', 'claude-sonnet-4-5', ?, 2300, 470, 1800, 500, 0.01242, 'tool_use')`,
      ["msg_a2", "sess_oc_1", t0 + 7_800],
    );
    db.run(
      `INSERT INTO parts (id, message_id, session_id, type, tool_name, tool_call_id,
        tool_status, tool_duration_ms, time_created)
       VALUES (?, 'msg_a2', 'sess_oc_1', 'tool', 'Bash', 'call_2', NULL, NULL, ?)`,
      ["part_t2", t0 + 7_900],
    );
    db.run(
      `INSERT INTO parts (id, message_id, session_id, type, tool_name, tool_call_id,
        tool_status, tool_duration_ms, time_created)
       VALUES (?, 'msg_a2', 'sess_oc_1', 'tool-result', 'Bash', 'call_2', 'error', 412, ?)`,
      ["part_tr2", t0 + 8_500],
    );

    // final assistant with end_turn
    db.run(
      `INSERT INTO messages (id, session_id, role, provider_id, model_id, time_created,
        input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens,
        cost_usd, finish_reason)
       VALUES (?, ?, 'assistant', 'anthropic', 'claude-sonnet-4-5', ?, 2700, 244, 2300, 400, 0.00788, 'end_turn')`,
      ["msg_a3", "sess_oc_1", t0 + 11_500],
    );
  } finally {
    db.close();
  }
}
