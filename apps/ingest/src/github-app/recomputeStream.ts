// Producer for `session_repo_recompute:{tenant_id}` Redis Streams messages
// (PRD §10, D56).
//
// This module is the PRODUCER side only — G1-linker owns the CONSUMER. The
// shape emitted here is the commutativity invariant's input surface:
// structural hashes + counts + minimal identifiers, never raw human strings.
//
// The Redis client abstraction mirrors `apps/ingest/src/wal/redisStreamsWal`
// — we reuse the same shared node-redis client at boot.
//
// Forbidden-field discipline (D57):
//   evidence in session_repo_links MUST NOT carry raw titles, commit
//   messages, or CODEOWNERS login strings. Downstream (the linker) reads
//   from the messages we produce here; therefore our payload can ONLY
//   include:
//
//   - trigger: one of the six trigger kinds (§10)
//   - tenant_id, installation_id (already tenant-scoped)
//   - provider_repo_id, pr_number, commit_sha (OID strings), suite_id
//   - structural counts (additions, deletions, changed_files, runs_count)
//   - hashes (title_hash, author_login_hash — hex-encoded sha256)
//   - booleans (draft, from_fork, forced, has_closes_keyword)
//
//   NEVER: title, body, commit_message, login, email, branch_label,
//   compare_url, file_paths, CODEOWNERS rules.

export type RecomputeTrigger =
  | "webhook_pr_upsert"
  | "webhook_push"
  | "webhook_check_suite"
  | "webhook_installation_state"
  | "webhook_repository_rename_or_transfer"
  | "webhook_deployment"
  | "webhook_deployment_status";

export interface RecomputeMessage {
  schema_version: 1;
  trigger: RecomputeTrigger;
  tenant_id: string;
  installation_id: string;
  received_at: string;
  payload: Record<string, unknown>;
}

export const RECOMPUTE_SCHEMA_VERSION: RecomputeMessage["schema_version"] = 1;

/**
 * Minimal Redis Streams client surface — just xadd for the producer path.
 * Consumer lives in G1-linker; its surface is larger (xReadGroup, xAck…).
 */
export interface RecomputeStreamProducer {
  /**
   * Publish a recompute message to `session_repo_recompute:{tenant_id}`.
   * Resolves with the Redis-assigned stream id.
   */
  publish(msg: RecomputeMessage): Promise<string>;
  /** Idempotent graceful drain. */
  close(): Promise<void>;
}

/**
 * In-memory test double — records messages in a per-stream array.
 */
export class InMemoryRecomputeStream implements RecomputeStreamProducer {
  private readonly streams = new Map<string, Array<{ id: string; msg: RecomputeMessage }>>();
  private seq = 0;
  private closed = false;

  async publish(msg: RecomputeMessage): Promise<string> {
    if (this.closed) throw new Error("recompute-stream:closed");
    const stream = `session_repo_recompute:${msg.tenant_id}`;
    let arr = this.streams.get(stream);
    if (!arr) {
      arr = [];
      this.streams.set(stream, arr);
    }
    const id = `${Date.now()}-${this.seq++}`;
    arr.push({ id, msg });
    return id;
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  readStream(tenant_id: string): Array<{ id: string; msg: RecomputeMessage }> {
    return this.streams.get(`session_repo_recompute:${tenant_id}`) ?? [];
  }

  allTenants(): string[] {
    return Array.from(this.streams.keys()).map((k) =>
      k.startsWith("session_repo_recompute:") ? k.slice("session_repo_recompute:".length) : k,
    );
  }
}

export function createInMemoryRecomputeStream(): InMemoryRecomputeStream {
  return new InMemoryRecomputeStream();
}
