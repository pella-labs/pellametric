// 30-second tumbling-window coalescer per (tenant_id, session_id).
//
// N duplicate recompute messages for the same (tenant, session) within 30s
// collapse into ONE recompute task. The coalescer is in-memory — when we
// scale to multi-instance, stream consumers must partition by session_id so
// the same session is owned by one consumer.
//
// Flush semantics:
//   - Tumbling: every `windowMs` ms, flush all pending windows.
//   - Immediate: `installation.suspend`/`unsuspend`/`deleted` triggers bypass
//     the window (PRD §10 "synthesizes a message for every live session_id").
//   - Drain-on-close: a graceful shutdown flushes pending windows once.
//
// ACK-after-flush contract (B4a):
//   - `add()` accepts an optional `entryRef: { streamKey, id }` — the
//     Redis Streams entry that triggered this coalesce. The coalescer
//     accumulates the full set of entry refs on the pending window.
//   - `flushDue`/`flushOne`/`drainAll` hand the entry refs to the handler
//     via `entry.ids`. The consumer ACKs those ids only after the handler
//     returns successfully; on throw the entry stays in XPENDING and the
//     next XREADGROUP claim re-delivers.
//
// Delivery:
//   - `flushDue(handler)` invokes `handler(key, entry)` for each pending
//     window and removes it from the map. Handler failures re-queue the
//     key by re-adding it with its original `firstSeenAt` + ids.

export interface CoalesceKey {
  tenant_id: string;
  session_id: string;
}

export interface StreamEntryRef {
  streamKey: string;
  id: string;
}

export interface CoalesceEntry {
  firstSeenAt: number;
  count: number;
  /** Stream entry refs that contributed to this window. ACKed only after
   *  the handler returns successfully. */
  ids: StreamEntryRef[];
  /** last trigger reason observed — purely diagnostic, not load-bearing. */
  lastTrigger?: string;
}

export interface CoalescerOptions {
  windowMs?: number;
  /** Current-time provider for deterministic tests. */
  now?: () => number;
}

const IMMEDIATE_TRIGGERS = new Set<string>([
  "webhook_installation_state",
  "installation_suspend_synthetic",
  "installation_unsuspend_synthetic",
  "installation_deleted_synthetic",
]);

export class WindowCoalescer {
  private readonly windowMs: number;
  private readonly pending = new Map<string, CoalesceEntry>();
  private readonly now: () => number;

  constructor(opts: CoalescerOptions = {}) {
    this.windowMs = opts.windowMs ?? 30_000;
    this.now = opts.now ?? Date.now;
  }

  /** Returns `true` if this trigger should bypass the window and flush
   *  immediately after enqueueing. */
  add(key: CoalesceKey, trigger: string, entryRef?: StreamEntryRef): { immediate: boolean } {
    const k = serialise(key);
    const nowMs = this.now();
    const existing = this.pending.get(k);
    if (existing) {
      existing.count += 1;
      existing.lastTrigger = trigger;
      if (entryRef) existing.ids.push(entryRef);
    } else {
      this.pending.set(k, {
        firstSeenAt: nowMs,
        count: 1,
        lastTrigger: trigger,
        ids: entryRef ? [entryRef] : [],
      });
    }
    return { immediate: IMMEDIATE_TRIGGERS.has(trigger) };
  }

  /** Return the subset of pending windows whose age ≥ windowMs. */
  dueKeys(): CoalesceKey[] {
    const out: CoalesceKey[] = [];
    const nowMs = this.now();
    for (const [k, e] of this.pending) {
      if (nowMs - e.firstSeenAt >= this.windowMs) out.push(deserialise(k));
    }
    return out;
  }

  /** Emit all due windows via the handler. Retains entries whose handler
   *  throws so the next `flush()` retries. */
  async flushDue(
    handler: (key: CoalesceKey, entry: CoalesceEntry) => Promise<void>,
  ): Promise<number> {
    const due = this.dueKeys();
    let emitted = 0;
    for (const key of due) {
      const k = serialise(key);
      const entry = this.pending.get(k);
      if (!entry) continue;
      this.pending.delete(k);
      try {
        await handler(key, entry);
        emitted += 1;
      } catch (err) {
        // Re-queue with original firstSeenAt so it remains due.
        this.pending.set(k, entry);
        throw err;
      }
    }
    return emitted;
  }

  /** Force-flush a specific window (e.g. installation-suspend synthetic). */
  async flushOne(
    key: CoalesceKey,
    handler: (key: CoalesceKey, entry: CoalesceEntry) => Promise<void>,
  ): Promise<boolean> {
    const k = serialise(key);
    const entry = this.pending.get(k);
    if (!entry) return false;
    this.pending.delete(k);
    try {
      await handler(key, entry);
      return true;
    } catch (err) {
      this.pending.set(k, entry);
      throw err;
    }
  }

  /** Drain all pending windows regardless of age — use only on shutdown. */
  async drainAll(
    handler: (key: CoalesceKey, entry: CoalesceEntry) => Promise<void>,
  ): Promise<number> {
    let emitted = 0;
    for (const [k, entry] of [...this.pending]) {
      this.pending.delete(k);
      try {
        await handler(deserialise(k), entry);
        emitted += 1;
      } catch (err) {
        this.pending.set(k, entry);
        throw err;
      }
    }
    return emitted;
  }

  size(): number {
    return this.pending.size;
  }

  /** Total entry refs across all pending windows — exposed so callers can
   *  surface a `github_linker_retry_pending_depth` gauge without poking at
   *  Redis XPENDING directly. */
  pendingIdsCount(): number {
    let n = 0;
    for (const e of this.pending.values()) n += e.ids.length;
    return n;
  }

  clear(): void {
    this.pending.clear();
  }
}

function serialise(k: CoalesceKey): string {
  return `${k.tenant_id}|${k.session_id}`;
}
function deserialise(s: string): CoalesceKey {
  const [tenant_id = "", session_id = ""] = s.split("|");
  return { tenant_id, session_id };
}
