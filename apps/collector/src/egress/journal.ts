import type { Database } from "bun:sqlite";
import type { Event } from "@bematist/schema";

export interface PendingRow {
  client_event_id: string;
  body_json: string;
  enqueued_at: string;
  retry_count: number;
  last_error: string | null;
}

export interface JournalRow extends PendingRow {
  submitted_at: string | null;
  state: string;
  next_attempt_at: string | null;
}

export interface MarkFailedOptions {
  /** Permanent failure — move directly to dead_letter (400, 413, 207 per-row rejects). */
  permanent?: boolean;
  /**
   * Transient failure — move to cooling and set next_attempt_at = now+retryAfterMs.
   * Row becomes reselectable only after the window elapses.
   */
  retryAfterMs?: number;
}

/**
 * Retry cap before a row is force-dead-lettered. Matches the default backoff
 * cadence (30 min cap) so after ~12 attempts we've waited the operator's
 * attention span and should stop reselecting.
 */
export const MAX_RETRIES = 12;

export class Journal {
  constructor(private readonly db: Database) {}

  enqueue(event: Event): void {
    this.db.run(
      `INSERT OR IGNORE INTO events (client_event_id, body_json, enqueued_at, state)
       VALUES (?, ?, ?, 'pending')`,
      [event.client_event_id, JSON.stringify(event), new Date().toISOString()],
    );
  }

  /**
   * Select rows ready to flush: state='pending' OR state='cooling' with an
   * expired next_attempt_at. Dead-lettered rows NEVER reselect.
   */
  selectPending(limit: number): PendingRow[] {
    const now = new Date().toISOString();
    return this.db
      .query<PendingRow, [string, number]>(
        `SELECT client_event_id, body_json, enqueued_at, retry_count, last_error
         FROM events
         WHERE state = 'pending'
            OR (state = 'cooling' AND (next_attempt_at IS NULL OR next_attempt_at <= ?))
         ORDER BY enqueued_at ASC LIMIT ?`,
      )
      .all(now, limit);
  }

  markSubmitted(ids: string[]): void {
    if (ids.length === 0) return;
    const now = new Date().toISOString();
    const stmt = this.db.prepare(
      `UPDATE events
       SET submitted_at = ?, state = 'submitted', last_error = NULL, next_attempt_at = NULL
       WHERE client_event_id = ?`,
    );
    this.db.transaction(() => {
      for (const id of ids) stmt.run(now, id);
    })();
  }

  /**
   * Mark rows as failed. Default behavior (no opts) bumps retry_count but
   * leaves the row pending; retry_count >= MAX_RETRIES flips it to dead_letter.
   *
   * - opts.permanent=true  → state='dead_letter' immediately (non-retry 4xx
   *   and per-row 207 rejects).
   * - opts.retryAfterMs set → state='cooling', next_attempt_at = now+ms; row
   *   becomes reselectable only after the cooldown elapses.
   *
   * Whichever path is taken, retry_count is incremented; post-increment
   * retry_count >= MAX_RETRIES forces dead_letter regardless of opts (so a
   * genuinely broken upstream can't churn the queue forever).
   */
  markFailed(ids: string[], lastError: string, opts: MarkFailedOptions = {}): void {
    if (ids.length === 0) return;
    const permanent = opts.permanent ?? false;
    const nextAttemptAt =
      opts.retryAfterMs != null ? new Date(Date.now() + opts.retryAfterMs).toISOString() : null;

    const selectStmt = this.db.prepare<{ retry_count: number } | null, [string]>(
      `SELECT retry_count FROM events WHERE client_event_id = ?`,
    );
    const updatePermanent = this.db.prepare(
      `UPDATE events
       SET retry_count = retry_count + 1, last_error = ?, state = 'dead_letter',
           next_attempt_at = NULL
       WHERE client_event_id = ?`,
    );
    const updateCooling = this.db.prepare(
      `UPDATE events
       SET retry_count = retry_count + 1, last_error = ?, state = 'cooling',
           next_attempt_at = ?
       WHERE client_event_id = ?`,
    );
    const updatePending = this.db.prepare(
      `UPDATE events
       SET retry_count = retry_count + 1, last_error = ?, state = 'pending',
           next_attempt_at = NULL
       WHERE client_event_id = ?`,
    );

    this.db.transaction(() => {
      for (const id of ids) {
        // Cap check: if this bump would hit/exceed MAX_RETRIES, force dead_letter.
        const row = selectStmt.get(id);
        const currentRetryCount = row?.retry_count ?? 0;
        const wouldExceedCap = currentRetryCount + 1 >= MAX_RETRIES;

        if (permanent || wouldExceedCap) {
          updatePermanent.run(lastError, id);
        } else if (nextAttemptAt != null) {
          updateCooling.run(lastError, nextAttemptAt, id);
        } else {
          updatePending.run(lastError, id);
        }
      }
    })();
  }

  /** Count of rows currently eligible to flush (pending + cooling with elapsed window). */
  pendingCount(): number {
    const now = new Date().toISOString();
    return (
      this.db
        .query<{ c: number }, [string]>(
          `SELECT COUNT(*) AS c FROM events
           WHERE state = 'pending'
              OR (state = 'cooling' AND (next_attempt_at IS NULL OR next_attempt_at <= ?))`,
        )
        .get(now)?.c ?? 0
    );
  }

  /** Count of dead-lettered rows — surfaced in `bematist audit --tail`. */
  deadLetterCount(): number {
    return (
      this.db
        .query<{ c: number }, []>(`SELECT COUNT(*) AS c FROM events WHERE state = 'dead_letter'`)
        .get()?.c ?? 0
    );
  }

  /** Most recent dead-letter rows, newest first. For forensic audit output. */
  tailDeadLetter(limit: number): JournalRow[] {
    return this.db
      .query<JournalRow, [number]>(
        `SELECT client_event_id, body_json, enqueued_at, retry_count, last_error,
                submitted_at, state, next_attempt_at
         FROM events WHERE state = 'dead_letter'
         ORDER BY enqueued_at DESC LIMIT ?`,
      )
      .all(limit);
  }

  tail(limit: number): JournalRow[] {
    return this.db
      .query<JournalRow, [number]>(
        `SELECT client_event_id, body_json, enqueued_at, retry_count, last_error,
                submitted_at, state, next_attempt_at
         FROM events ORDER BY enqueued_at DESC LIMIT ?`,
      )
      .all(limit);
  }

  /**
   * Delete old rows to keep the SQLite file bounded on long-running machines.
   * Submitted rows beyond the retention window are dropped (the per-batch
   * egress.jsonl still has the audit trail). Dead-letter rows kept longer so
   * `bematist audit --tail` can show why a row was dropped.
   *
   * Returns the number of rows actually deleted.
   */
  prune(opts: { submittedRetentionDays: number; deadLetterRetentionDays: number }): {
    submittedDeleted: number;
    deadLetterDeleted: number;
  } {
    const submittedCutoff = new Date(
      Date.now() - opts.submittedRetentionDays * 86_400_000,
    ).toISOString();
    const deadCutoff = new Date(
      Date.now() - opts.deadLetterRetentionDays * 86_400_000,
    ).toISOString();
    let submittedDeleted = 0;
    let deadLetterDeleted = 0;
    this.db.transaction(() => {
      submittedDeleted =
        this.db.run(
          `DELETE FROM events WHERE state = 'submitted' AND submitted_at IS NOT NULL
           AND submitted_at < ?`,
          [submittedCutoff],
        ).changes ?? 0;
      deadLetterDeleted =
        this.db.run(`DELETE FROM events WHERE state = 'dead_letter' AND enqueued_at < ?`, [
          deadCutoff,
        ]).changes ?? 0;
    })();
    return { submittedDeleted, deadLetterDeleted };
  }
}
