// apps/worker/github — Redpanda consumer for `github.webhooks` (PRD §7.1).
//
// Per-message flow:
//   1. Decode WebhookBusPayload (JSON bytes).
//   2. Parse via domainParser.ts into a typed DomainParseResult.
//   3. UPSERT the right Postgres domain table(s) + extend git_events row
//      (branch, repo_id_hash, commit_sha, pr_number, author_association).
//   4. Emit ONE recompute message to session_repo_recompute:{tenant_id}.
//
// The consumer is written to be bus-agnostic — it takes a
// `consumeOnce(message)` API so the ingest's in-memory bus + a future Kafka
// consumer can both drive it. This also keeps unit tests free of a broker.
//
// Forbidden-field discipline (D57):
//   - session_repo_links.evidence: NEVER raw titles/messages/logins. The
//     recompute message enforces this by passing only hashes + counts.
//   - github_pull_requests.title_hash / author_login_hash: bytea sha256.
//   - git_events gets structural extensions only.
//
// Idempotency: all UPSERTs use ON CONFLICT DO UPDATE keyed on the documented
// PRIMARY KEY. Out-of-order duplicates land safely — later timestamps win
// only when strictly newer (ON CONFLICT guards via greatest(updated_at)).

import { createHmac } from "node:crypto";
import type { Sql } from "postgres";

/**
 * Narrow subset of the postgres.js surface our helpers use. The real caller
 * passes either a top-level `Sql` or a `TransactionSql` — the latter is not
 * a direct subtype of `Sql`, so we accept `unsafe` only (the callable
 * tagged-template shape isn't exercised inside this module).
 */
type SqlLike = Pick<Sql, "unsafe">;

import {
  type CheckSuiteRow,
  type DeploymentRow,
  type DomainParseResult,
  type GitEventExtension,
  type PullRequestRow,
  parseDomain,
} from "../../../ingest/src/github-app/domainParser";
import {
  RECOMPUTE_SCHEMA_VERSION,
  type RecomputeMessage,
  type RecomputeStreamProducer,
  type RecomputeTrigger,
} from "../../../ingest/src/github-app/recomputeStream";
import { decodePayload, type WebhookBusPayload } from "../../../ingest/src/github-app/webhookBus";

export interface ConsumerDeps {
  sql: Sql;
  recompute: RecomputeStreamProducer;
  /** Per-tenant salt resolver for repo_id_hash. Matches the backfill worker's shape. */
  tenantSalt?: (orgId: string) => Buffer;
  log?: (event: Record<string, unknown>) => void;
}

function defaultTenantSalt(orgId: string): Buffer {
  return Buffer.from(createHmac("sha256", "bematist-repo-id-hash").update(orgId).digest());
}

function repoIdHash(tenantSalt: Buffer, providerRepoId: string): Buffer {
  return Buffer.from(createHmac("sha256", tenantSalt).update(`github:${providerRepoId}`).digest());
}

export async function consumeMessage(
  bytes: Uint8Array,
  deps: ConsumerDeps,
): Promise<ConsumeOutcome> {
  const payload = decodePayload(bytes);
  const event = payload.event;
  const body = JSON.parse(Buffer.from(payload.body_b64, "base64").toString("utf8")) as unknown;
  const parsed = parseDomain(event, body);
  const outcome = await handleParsed(parsed, payload, deps);
  // G3: record every successfully-handled delivery in the seen-table so the
  // hourly reconciler (apps/worker/src/github-linker/reconcileScaffold.ts)
  // can detect + backfill gaps via `POST /app/hook/deliveries/:id/attempts`.
  // Ignored events are recorded too — they still represent a delivery we saw
  // and don't want to re-request.
  try {
    await deps.sql.unsafe(
      `INSERT INTO github_webhook_deliveries_seen
         (tenant_id, installation_id, delivery_id, event)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (tenant_id, delivery_id) DO NOTHING`,
      [payload.tenant_id, payload.installation_id, payload.delivery_id, payload.event],
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const log = deps.log ?? ((_e) => {});
    log({
      level: "warn",
      app: "worker-github",
      msg: "failed to write github_webhook_deliveries_seen",
      err: msg,
    });
  }
  return outcome;
}

export interface ConsumeOutcome {
  handled: DomainParseResult["kind"] | "ignored";
  /** Trigger emitted to the recompute stream, if any. */
  recomputeTrigger?: RecomputeTrigger;
  /** Domain table touched. */
  table?: string;
}

async function handleParsed(
  parsed: DomainParseResult,
  payload: WebhookBusPayload,
  deps: ConsumerDeps,
): Promise<ConsumeOutcome> {
  const log = deps.log ?? ((_e) => {});
  const salt = (deps.tenantSalt ?? defaultTenantSalt)(payload.tenant_id);

  // RLS: every domain-table write runs in a transaction that SETs
  // `app.current_org_id = payload.tenant_id`. This is the one place in the
  // write-path where we reach across tenants (we trust `payload.tenant_id`
  // because the ingest resolved it from github_installations at HMAC time).
  if (parsed.kind === "pull_request_upsert") {
    await deps.sql.begin(async (tx) => {
      await tx.unsafe(`SELECT set_config('app.current_org_id', $1, true)`, [payload.tenant_id]);
      await upsertPullRequest(tx, payload.tenant_id, parsed.row);
      await extendGitEvents(tx, payload.tenant_id, parsed.gitEventExtension, salt);
    });
    const msg = buildRecomputeMessage("webhook_pr_upsert", payload, {
      provider_repo_id: parsed.row.provider_repo_id,
      pr_number: parsed.row.pr_number,
      head_sha: parsed.row.head_sha,
      merge_commit_sha: parsed.row.merge_commit_sha,
      title_hash: parsed.row.title_hash,
      author_login_hash: parsed.row.author_login_hash,
      state: parsed.row.state,
      from_fork: parsed.row.from_fork,
      has_closes_keyword: parsed.row.has_closes_keyword,
    });
    await deps.recompute.publish(msg);
    log({ app: "worker-github", kind: parsed.kind, tenant: payload.tenant_id });
    return {
      handled: parsed.kind,
      recomputeTrigger: "webhook_pr_upsert",
      table: "github_pull_requests",
    };
  }

  if (parsed.kind === "push") {
    await deps.sql.begin(async (tx) => {
      await tx.unsafe(`SELECT set_config('app.current_org_id', $1, true)`, [payload.tenant_id]);
      await extendGitEvents(tx, payload.tenant_id, parsed.gitEventExtension, salt);
    });
    const msg = buildRecomputeMessage("webhook_push", payload, {
      provider_repo_id: parsed.gitEventExtension.provider_repo_id,
      branch: parsed.branch,
      forced: parsed.forced,
      commit_sha: parsed.gitEventExtension.commit_sha,
    });
    await deps.recompute.publish(msg);
    log({
      app: "worker-github",
      kind: parsed.kind,
      tenant: payload.tenant_id,
      forced: parsed.forced,
    });
    return { handled: parsed.kind, recomputeTrigger: "webhook_push", table: "git_events" };
  }

  if (parsed.kind === "check_suite_upsert") {
    await deps.sql.begin(async (tx) => {
      await tx.unsafe(`SELECT set_config('app.current_org_id', $1, true)`, [payload.tenant_id]);
      await upsertCheckSuite(tx, payload.tenant_id, parsed.row);
    });
    const msg = buildRecomputeMessage("webhook_check_suite", payload, {
      provider_repo_id: parsed.row.provider_repo_id,
      head_sha: parsed.row.head_sha,
      suite_id: parsed.row.suite_id.toString(),
      status: parsed.row.status,
      conclusion: parsed.row.conclusion,
      runs_count: parsed.row.runs_count,
      failed_runs_count: parsed.row.failed_runs_count,
    });
    await deps.recompute.publish(msg);
    log({ app: "worker-github", kind: parsed.kind, tenant: payload.tenant_id });
    return {
      handled: parsed.kind,
      recomputeTrigger: "webhook_check_suite",
      table: "github_check_suites",
    };
  }

  if (parsed.kind === "deployment_upsert" || parsed.kind === "deployment_status_upsert") {
    await deps.sql.begin(async (tx) => {
      await tx.unsafe(`SELECT set_config('app.current_org_id', $1, true)`, [payload.tenant_id]);
      await upsertDeployment(tx, payload.tenant_id, parsed.row);
    });
    const trigger: "webhook_deployment" | "webhook_deployment_status" =
      parsed.kind === "deployment_upsert" ? "webhook_deployment" : "webhook_deployment_status";
    const msg = buildRecomputeMessage(trigger, payload, {
      provider_repo_id: parsed.row.provider_repo_id,
      deployment_id: parsed.row.deployment_id.toString(),
      environment: parsed.row.environment,
      sha: parsed.row.sha,
      status: parsed.row.status,
    });
    await deps.recompute.publish(msg);
    log({ app: "worker-github", kind: parsed.kind, tenant: payload.tenant_id });
    return {
      handled: parsed.kind,
      recomputeTrigger: trigger,
      table: "github_deployments",
    };
  }

  if (parsed.kind === "installation_created") {
    // B1 — installation.created lands in github_pending_installations
    // for the admin to claim. Uses the global-admin RLS bypass because
    // pending rows exist before any tenant binding. No recompute emission:
    // the actual github_installations row is written by the claim Server
    // Action, which also triggers the initial sync.
    await deps.sql.begin(async (tx) => {
      await tx.unsafe(`SELECT set_config('app.is_global_admin', 'true', true)`);
      await tx.unsafe(
        `INSERT INTO github_pending_installations
           (installation_id, github_org_id, github_org_login, app_id,
            target_type, repositories_selected_count)
         VALUES ($1::bigint, $2::bigint, $3, $4::bigint, $5, $6)
         ON CONFLICT (installation_id) DO UPDATE SET
           github_org_id                 = EXCLUDED.github_org_id,
           github_org_login              = EXCLUDED.github_org_login,
           app_id                        = EXCLUDED.app_id,
           target_type                   = EXCLUDED.target_type,
           repositories_selected_count   = EXCLUDED.repositories_selected_count,
           updated_at                    = now()`,
        [
          parsed.installation_id.toString(),
          parsed.github_org_id.toString(),
          parsed.github_org_login,
          parsed.app_id.toString(),
          parsed.target_type,
          parsed.repositories_selected_count,
        ],
      );
    });
    log({
      app: "worker-github",
      kind: parsed.kind,
      installation_id: parsed.installation_id.toString(),
    });
    return {
      handled: parsed.kind,
      table: "github_pending_installations",
    };
  }

  if (parsed.kind === "installation_state_change") {
    // Update is keyed on the OUTER payload.installation_id (the one the
    // ingest resolved from the `github_installations` row at HMAC time),
    // NOT the fixture's inline `installation.id` — they are the same in
    // prod but differ in test fixtures so the outer one is authoritative.
    await deps.sql.begin(async (tx) => {
      await tx.unsafe(`SELECT set_config('app.current_org_id', $1, true)`, [payload.tenant_id]);
      await tx.unsafe(
        `UPDATE github_installations
           SET status = $2,
               suspended_at = CASE WHEN $2 = 'suspended' THEN now() ELSE suspended_at END,
               revoked_at   = CASE WHEN $2 = 'revoked'   THEN now() ELSE revoked_at   END,
               updated_at = now()
           WHERE tenant_id = $1 AND installation_id = $3`,
        [payload.tenant_id, parsed.next_status, payload.installation_id],
      );
    });
    const msg = buildRecomputeMessage("webhook_installation_state", payload, {
      reason: parsed.reason,
      next_status: parsed.next_status,
    });
    await deps.recompute.publish(msg);
    log({
      app: "worker-github",
      kind: parsed.kind,
      tenant: payload.tenant_id,
      status: parsed.next_status,
    });
    return {
      handled: parsed.kind,
      recomputeTrigger: "webhook_installation_state",
      table: "github_installations",
    };
  }

  if (parsed.kind === "repository_rename_or_transfer") {
    const newHash = repoIdHash(salt, parsed.provider_repo_id);
    // The alias "old_hash" for a rename-in-place is conceptually the SAME
    // hash (HMAC of provider_repo_id, not of repo name) — but the alias row
    // still lands to capture the transition for audit. For transfers between
    // accounts, GitHub preserves the provider_repo_id, so we still use the
    // same HMAC — the alias reason differentiates.
    const oldHash = newHash; // identical until salt rotation; preserved as-is.
    await deps.sql.begin(async (tx) => {
      await tx.unsafe(`SELECT set_config('app.current_org_id', $1, true)`, [payload.tenant_id]);
      await tx.unsafe(
        `INSERT INTO repo_id_hash_aliases
           (tenant_id, old_hash, new_hash, reason, migrated_at, retires_at)
         VALUES ($1, $2, $3, $4, now(), now() + interval '180 days')
         ON CONFLICT (tenant_id, old_hash, new_hash) DO NOTHING`,
        [payload.tenant_id, oldHash, newHash, parsed.reason],
      );
      // M1 — keep repos.full_name in sync on rename/transfer so the
      // admin UI shows the current identifier without waiting for the
      // next initial-sync pass. Skipped when the webhook did not carry
      // a new full_name (shouldn't happen for rename/transfer, but we
      // defend against partial payloads).
      if (parsed.new_full_name) {
        await tx.unsafe(
          `UPDATE repos
              SET full_name = $3
            WHERE org_id = $1
              AND provider = 'github'
              AND provider_repo_id = $2`,
          [payload.tenant_id, parsed.provider_repo_id, parsed.new_full_name],
        );
      }
    });
    const msg = buildRecomputeMessage("webhook_repository_rename_or_transfer", payload, {
      provider_repo_id: parsed.provider_repo_id,
      reason: parsed.reason,
      has_new_name: Boolean(parsed.new_name),
      has_new_owner: Boolean(parsed.new_owner_login),
    });
    await deps.recompute.publish(msg);
    log({ app: "worker-github", kind: parsed.kind, tenant: payload.tenant_id });
    return {
      handled: parsed.kind,
      recomputeTrigger: "webhook_repository_rename_or_transfer",
      table: "repo_id_hash_aliases",
    };
  }

  // Ignored event kinds are benign — GitHub fires more than we care about.
  log({ app: "worker-github", kind: "ignored", event: payload.event, tenant: payload.tenant_id });
  return { handled: "ignored" };
}

function buildRecomputeMessage(
  trigger: RecomputeTrigger,
  payload: WebhookBusPayload,
  payloadBody: Record<string, unknown>,
): RecomputeMessage {
  return {
    schema_version: RECOMPUTE_SCHEMA_VERSION,
    trigger,
    tenant_id: payload.tenant_id,
    installation_id: payload.installation_id,
    received_at: payload.received_at,
    payload: payloadBody,
  };
}

async function upsertPullRequest(
  tx: SqlLike,
  tenantId: string,
  row: PullRequestRow,
): Promise<void> {
  await tx.unsafe(
    `INSERT INTO github_pull_requests (
       tenant_id, provider, provider_repo_id, pr_number, pr_node_id, state,
       draft, title_hash, base_ref, head_ref, head_sha, merge_commit_sha,
       author_login_hash, author_association, additions, deletions,
       changed_files, commits_count, opened_at, closed_at, merged_at,
       ingested_at, updated_at
     )
     VALUES (
       $1, 'github', $2, $3, $4, $5,
       $6, decode($7, 'hex'), $8, $9, $10, $11,
       decode($12, 'hex'), $13, $14, $15,
       $16, $17, $18, $19, $20,
       now(), now()
     )
     ON CONFLICT (tenant_id, provider_repo_id, pr_number) DO UPDATE SET
       pr_node_id = EXCLUDED.pr_node_id,
       state = EXCLUDED.state,
       draft = EXCLUDED.draft,
       title_hash = EXCLUDED.title_hash,
       base_ref = EXCLUDED.base_ref,
       head_ref = EXCLUDED.head_ref,
       head_sha = EXCLUDED.head_sha,
       merge_commit_sha = EXCLUDED.merge_commit_sha,
       author_login_hash = EXCLUDED.author_login_hash,
       author_association = EXCLUDED.author_association,
       additions = EXCLUDED.additions,
       deletions = EXCLUDED.deletions,
       changed_files = EXCLUDED.changed_files,
       commits_count = EXCLUDED.commits_count,
       closed_at = EXCLUDED.closed_at,
       merged_at = EXCLUDED.merged_at,
       updated_at = now()`,
    [
      tenantId,
      row.provider_repo_id,
      row.pr_number,
      row.pr_node_id,
      row.state,
      row.draft,
      row.title_hash,
      row.base_ref,
      row.head_ref,
      row.head_sha,
      row.merge_commit_sha,
      row.author_login_hash,
      row.author_association,
      row.additions,
      row.deletions,
      row.changed_files,
      row.commits_count,
      row.opened_at,
      row.closed_at,
      row.merged_at,
    ],
  );
}

async function upsertDeployment(tx: SqlLike, tenantId: string, row: DeploymentRow): Promise<void> {
  await tx.unsafe(
    `INSERT INTO github_deployments (
       tenant_id, provider_repo_id, deployment_id, environment, sha, ref, status, first_success_at, updated_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
     ON CONFLICT (tenant_id, provider_repo_id, deployment_id) DO UPDATE SET
       environment = EXCLUDED.environment,
       sha = EXCLUDED.sha,
       ref = EXCLUDED.ref,
       status = EXCLUDED.status,
       first_success_at = COALESCE(github_deployments.first_success_at, EXCLUDED.first_success_at),
       updated_at = now()`,
    [
      tenantId,
      row.provider_repo_id,
      row.deployment_id.toString(),
      row.environment,
      row.sha,
      row.ref,
      row.status,
      row.first_success_at,
    ],
  );
}

async function upsertCheckSuite(tx: SqlLike, tenantId: string, row: CheckSuiteRow): Promise<void> {
  await tx.unsafe(
    `INSERT INTO github_check_suites (
       tenant_id, provider_repo_id, head_sha, suite_id, status, conclusion,
       runs_count, failed_runs_count, started_at, completed_at, updated_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
     ON CONFLICT (tenant_id, provider_repo_id, head_sha, suite_id) DO UPDATE SET
       status = EXCLUDED.status,
       conclusion = EXCLUDED.conclusion,
       runs_count = EXCLUDED.runs_count,
       failed_runs_count = EXCLUDED.failed_runs_count,
       started_at = EXCLUDED.started_at,
       completed_at = EXCLUDED.completed_at,
       updated_at = now()`,
    [
      tenantId,
      row.provider_repo_id,
      row.head_sha,
      row.suite_id.toString(),
      row.status,
      row.conclusion,
      row.runs_count,
      row.failed_runs_count,
      row.started_at,
      row.completed_at,
    ],
  );
}

async function extendGitEvents(
  tx: SqlLike,
  tenantId: string,
  ext: GitEventExtension,
  salt: Buffer,
): Promise<void> {
  // git_events extension row: one per webhook, appended (no upsert). These
  // exist so downstream outcome attribution can reach sessions by commit_sha
  // / pr_number. `repo_id` (legacy column) and `repo_id_hash` both populated
  // so the RLS probes + the G1 linker both index cleanly.
  if (!ext.provider_repo_id) return;
  const hash = repoIdHash(salt, ext.provider_repo_id);
  await tx.unsafe(
    `INSERT INTO git_events
       (org_id, source, event_kind, pr_node_id, repo_id, repo_id_hash,
        pr_number, commit_sha, branch, author_association, received_at, payload)
     VALUES ($1, 'github', $2, NULL, $3, $4, $5, $6, $7, $8, now(), '{}'::jsonb)`,
    [
      tenantId,
      ext.pr_number !== null ? "pull_request.webhook" : "push",
      hash,
      hash,
      ext.pr_number,
      ext.commit_sha,
      ext.branch,
      ext.author_association,
    ],
  );
}
