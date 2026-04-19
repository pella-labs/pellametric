import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  char,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

// bytea helper — Drizzle doesn't ship a first-class `bytea` column; we use
// customType so the TS type is `Buffer | Uint8Array` and the raw column type
// is `bytea`. Reads/writes go through the postgres.js binary codec.
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

export const orgs = pgTable("orgs", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  /** PRD §9.9 — per-org tracking scope. 'all' | 'selected'. Default 'all' (A8). */
  github_repo_tracking_mode: text("github_repo_tracking_mode").notNull().default("all"),
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  org_id: uuid("org_id")
    .notNull()
    .references(() => orgs.id),
  sso_subject: text("sso_subject").notNull().unique(),
  email: text("email").notNull(),
  /**
   * Better Auth identity link per migration 0004_better_auth_tables.sql.
   * Nullable so pre-Better-Auth seeded rows still resolve; Better Auth
   * `databaseHooks.user.create.after` back-fills on first OAuth callback.
   */
  better_auth_user_id: text("better_auth_user_id")
    .unique()
    .references(() => betterAuthUser.id, { onDelete: "set null" }),
  /**
   * Dashboard RBAC role. Defaults to 'ic'; first user in an org is promoted
   * to 'admin' by the Better Auth sign-up hook. See apps/web/lib/auth.ts.
   */
  role: text("role").notNull().default("ic"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Better Auth identity tables (migration 0004_better_auth_tables.sql).
 *
 * Shape matches Better Auth's default `drizzleAdapter` schema (snake_case,
 * singular table names, text PKs). Do NOT rename columns — the adapter uses
 * the names below verbatim unless the config passes a field mapping.
 *
 * Decision record (M4 PR 1): option (a) — Better Auth owns its own tables;
 * our `users` table links via `users.better_auth_user_id`. Rollback = drop
 * these four tables and the two `users` columns added by migration 0004.
 */
// Better Auth 1.5+ expects camelCase JS field names (emailVerified, expiresAt,
// etc.) on the Drizzle schema even when the underlying columns are snake_case.
// The original migration declared the columns snake_case; we preserve those
// column names via `timestamp("expires_at", …)` / `text("user_id", …)` while
// exposing camelCase JS keys so Better Auth's adapter finds the fields.
export const betterAuthUser = pgTable("better_auth_user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const betterAuthSession = pgTable(
  "better_auth_session",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => betterAuthUser.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userIdx: index("better_auth_session_user_id_idx").on(table.userId),
    tokenIdx: index("better_auth_session_token_idx").on(table.token),
  }),
);

export const betterAuthAccount = pgTable(
  "better_auth_account",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => betterAuthUser.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    providerAccountUniq: uniqueIndex("better_auth_account_provider_account_uniq").on(
      table.providerId,
      table.accountId,
    ),
    userIdx: index("better_auth_account_user_id_idx").on(table.userId),
  }),
);

export const betterAuthVerification = pgTable(
  "better_auth_verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    identifierIdx: index("better_auth_verification_identifier_idx").on(table.identifier),
  }),
);

/**
 * /card flow — one-shot bearer tokens minted for the grammata CLI. Migration
 * 0005 replaces the Firestore `api_tokens` collection with this table.
 * Single-use semantics are enforced atomically via
 *   UPDATE card_tokens SET used_at=now() WHERE token_hash=$1
 *     AND used_at IS NULL AND expires_at > now() RETURNING ...
 * which removes the read-then-write race Firestore had.
 *
 * subject_kind = 'better_auth_user' (OAuth mint; subject_id = better_auth_user.id)
 *              | 'github_star'      (star-gate mint; subject_id = 'gh_<login>')
 */
export const cardTokens = pgTable(
  "card_tokens",
  {
    token_hash: text("token_hash").primaryKey(),
    subject_kind: text("subject_kind").notNull(),
    subject_id: text("subject_id").notNull(),
    github_username: text("github_username"),
    expires_at: timestamp("expires_at", { withTimezone: true }).notNull(),
    used_at: timestamp("used_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    subjectIdx: index("card_tokens_subject_idx").on(table.subject_kind, table.subject_id),
  }),
);

/**
 * /card flow — public shareable cards. Permanent storage; card_id equals the
 * subject_id of the token that minted it. Display fields are denormalized so
 * the public render doesn't need a join into Better Auth, and so deleting
 * the Better Auth user doesn't break an already-shared card URL.
 */
export const cards = pgTable(
  "cards",
  {
    card_id: text("card_id").primaryKey(),
    owner_user_id: text("owner_user_id").references(() => betterAuthUser.id, {
      onDelete: "set null",
    }),
    github_username: text("github_username"),
    display_name: text("display_name"),
    avatar_url: text("avatar_url"),
    stats: jsonb("stats").notNull(),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    ownerIdx: index("cards_owner_user_id_idx").on(table.owner_user_id),
  }),
);

/** Teams added in D1-05 scope bump — required by team_weekly_rollup's dev_team_dict CH dictionary. */
export const teams = pgTable("teams", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  org_id: uuid("org_id")
    .notNull()
    .references(() => orgs.id),
  name: text("name").notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const developers = pgTable("developers", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  org_id: uuid("org_id")
    .notNull()
    .references(() => orgs.id),
  user_id: uuid("user_id")
    .notNull()
    .references(() => users.id),
  /** Self-declared team membership per D1-02 design D3. Nullable until IC picks one. */
  team_id: uuid("team_id").references(() => teams.id),
  stable_hash: text("stable_hash").notNull().unique(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** HMAC of (repo_full_name, tenant_salt) per contract 09 open Q 2.
 *  Extended in G1 per PRD §9.9 — GitHub provider_repo_id + tracking state. */
export const repos = pgTable("repos", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  org_id: uuid("org_id")
    .notNull()
    .references(() => orgs.id),
  repo_id_hash: text("repo_id_hash").notNull().unique(),
  provider: text("provider").notNull(), // github | gitlab | bitbucket
  /** GitHub's stable numeric repo ID (D33). Nullable until backfilled. */
  provider_repo_id: varchar("provider_repo_id", { length: 32 }),
  /** Human-readable "owner/repo" identifier (M1). Nullable until the next
   *  sync or rename/transfer webhook populates it. Search-exposed via
   *  ILIKE in `packages/api/src/queries/github/repos.ts`; `repo_id_hash`
   *  remains internal-only (HMAC, never surfaced to admin UI). */
  full_name: text("full_name"),
  default_branch: text("default_branch"),
  first_seen_at: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
  archived_at: timestamp("archived_at", { withTimezone: true }),
  deleted_at: timestamp("deleted_at", { withTimezone: true }),
  /** 'inherit' | 'included' | 'excluded' per PRD §9.9 (A8 default 'all' on orgs). */
  tracking_state: text("tracking_state").notNull().default("inherit"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Paired with migration 0001_sprint1_auth.sql.
// Schema of record for apps/ingest/src/auth/verifyIngestKey.ts.
export const ingestKeys = pgTable(
  "ingest_keys",
  {
    id: text("id").primaryKey(),
    org_id: uuid("org_id")
      .notNull()
      .references(() => orgs.id),
    engineer_id: uuid("engineer_id").references(() => developers.id),
    name: text("name").notNull(),
    key_sha256: text("key_sha256").notNull(),
    tier_default: char("tier_default", { length: 1 }).notNull().default("B"),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    revoked_at: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => ({
    orgIdx: index("ingest_keys_org_idx").on(table.org_id),
  }),
);

// Paired with migration 0002_sprint1_policies.sql (shipped shape) + D1-05 additive
// fields (tier_c_signed_config, tier_c_activated_at) for Ed25519 signed-config (D20).
// One row per org; auto-inserted by the `orgs_insert_default_policy` trigger.
// Read by apps/ingest/src/tier/enforceTier.ts with a 60s cache.
export const policies = pgTable("policies", {
  org_id: uuid("org_id")
    .primaryKey()
    .references(() => orgs.id, { onDelete: "cascade" }),
  tier_c_managed_cloud_optin: boolean("tier_c_managed_cloud_optin").notNull().default(false),
  tier_default: char("tier_default", { length: 1 }).notNull().default("B"),
  raw_attrs_allowlist_extra: jsonb("raw_attrs_allowlist_extra").notNull().default(sql`'[]'::jsonb`),
  presidio_recognizers_extra: jsonb("presidio_recognizers_extra")
    .notNull()
    .default(sql`'[]'::jsonb`),
  trufflehog_rules_disabled: jsonb("trufflehog_rules_disabled").notNull().default(sql`'[]'::jsonb`),
  webhook_secrets: jsonb("webhook_secrets").notNull().default(sql`'{}'::jsonb`),
  webhook_source_ip_allowlist: jsonb("webhook_source_ip_allowlist")
    .notNull()
    .default(sql`'[]'::jsonb`),
  /** Ed25519 signed Tier-C admin-flip config per D20. Null until activated. */
  tier_c_signed_config: text("tier_c_signed_config"),
  tier_c_activated_at: timestamp("tier_c_activated_at", { withTimezone: true }),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Paired with migration 0003_sprint1_git_events.sql. Written by
// apps/ingest/src/webhooks/router.ts (webhooks) and
// apps/ingest/src/github-app/reconcile.ts (daily cron). UNIQUE constraint on
// pr_node_id gives the row-level dedup layer in D-S1-17.
export const gitEvents = pgTable(
  "git_events",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    org_id: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    source: text("source").notNull(),
    event_kind: text("event_kind").notNull(),
    pr_node_id: text("pr_node_id"),
    repo_id: text("repo_id").notNull(),
    pr_number: integer("pr_number"),
    commit_sha: text("commit_sha"),
    merged_at: timestamp("merged_at", { withTimezone: true }),
    payload: jsonb("payload").notNull(),
    received_at: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    // G1 additions per PRD §9.9 — scoring signal inputs. Populated by
    // backfill worker (apps/worker/src/github-backfill/) + incoming webhooks.
    branch: text("branch"),
    repo_id_hash: bytea("repo_id_hash"),
    author_association: text("author_association"),
  },
  (table) => ({
    prNodeUnique: uniqueIndex("git_events_pr_node_id_key").on(table.pr_node_id),
    orgIdx: index("git_events_org_idx").on(table.org_id),
    repoIdx: index("git_events_repo_idx").on(table.repo_id),
  }),
);

/** H's nightly cluster job writes centroids; E reads for cluster pages. */
export const prompt_clusters = pgTable("prompt_clusters", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  org_id: uuid("org_id")
    .notNull()
    .references(() => orgs.id),
  centroid: real("centroid").array().notNull(),
  dim: integer("dim").notNull(),
  model: text("model").notNull(),
  label: text("label"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** IC-promoted playbook (D31 Team Impact source). */
export const playbooks = pgTable("playbooks", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  org_id: uuid("org_id")
    .notNull()
    .references(() => orgs.id),
  cluster_id: uuid("cluster_id").references(() => prompt_clusters.id),
  session_id: text("session_id").notNull(),
  abstract: text("abstract").notNull(),
  outcome_metrics_json: jsonb("outcome_metrics_json").notNull().default(sql`'{}'::jsonb`),
  promoted_by: uuid("promoted_by")
    .notNull()
    .references(() => users.id),
  promoted_at: timestamp("promoted_at", { withTimezone: true }).notNull().defaultNow(),
  takedown_requested_at: timestamp("takedown_requested_at", { withTimezone: true }),
});

/**
 * Append-only audit trail. Contract 09 invariant 6: NEVER UPDATE, NEVER DELETE.
 * DB-level trigger enforces this; see custom/0001_audit_log_immutable.sql.
 * `org_id` is denormalized for RLS org-isolation — set at write time from the
 * actor's user row.
 */
export const audit_log = pgTable("audit_log", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
  org_id: uuid("org_id")
    .notNull()
    .references(() => orgs.id),
  actor_user_id: uuid("actor_user_id")
    .notNull()
    .references(() => users.id),
  action: text("action").notNull(),
  target_type: text("target_type").notNull(),
  target_id: text("target_id").notNull(),
  reason: text("reason"),
  metadata_json: jsonb("metadata_json").notNull().default(sql`'{}'::jsonb`),
});

/** D30 per-manager-view notification source — IC daily digest reads from here.
 *  `org_id` denormalized for RLS org-isolation (same pattern as audit_log). */
export const audit_events = pgTable("audit_events", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
  org_id: uuid("org_id")
    .notNull()
    .references(() => orgs.id),
  actor_user_id: uuid("actor_user_id")
    .notNull()
    .references(() => users.id),
  target_engineer_id_hash: text("target_engineer_id_hash").notNull(),
  surface: text("surface").notNull(), // engineer_page | 2x2 | session_reveal | cluster_page
  session_id_hash: text("session_id_hash"),
});

/**
 * GDPR erasure request queue. D's partition-drop worker watches `status='pending'`.
 * Schema per contract 09 §Per-table contracts.
 */
export const erasure_requests = pgTable("erasure_requests", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
  requester_user_id: uuid("requester_user_id")
    .notNull()
    .references(() => users.id),
  target_engineer_id: text("target_engineer_id").notNull(),
  target_org_id: uuid("target_org_id")
    .notNull()
    .references(() => orgs.id),
  // pending | in_progress | completed | failed
  status: text("status").notNull().default("pending"),
  completed_at: timestamp("completed_at", { withTimezone: true }),
  partition_dropped: text("partition_dropped").notNull().default("false"),
});

export const alerts = pgTable("alerts", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
  org_id: uuid("org_id")
    .notNull()
    .references(() => orgs.id),
  kind: text("kind").notNull(),
  signal: text("signal").notNull(),
  value: real("value").notNull(),
  threshold: real("threshold").notNull(),
  dev_id_hash: text("dev_id_hash"),
});

export const insights = pgTable("insights", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
  org_id: uuid("org_id")
    .notNull()
    .references(() => orgs.id),
  team_id: uuid("team_id").references(() => teams.id),
  week: text("week").notNull(), // ISO week string like 2026-W15
  body_json: jsonb("body_json").notNull().default(sql`'{}'::jsonb`),
  confidence: text("confidence").notNull(), // high | medium | low
});

export const outcomes = pgTable("outcomes", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
  org_id: uuid("org_id")
    .notNull()
    .references(() => orgs.id),
  engineer_id: text("engineer_id").notNull(),
  kind: text("kind").notNull(), // pr_merged | commit_landed | test_passed
  pr_number: integer("pr_number"),
  commit_sha: text("commit_sha"),
  session_id: text("session_id"),
  ai_assisted: boolean("ai_assisted").notNull().default(false),
});

/** Per contract 05 §Postgres canonical shape. */
export const embedding_cache = pgTable("embedding_cache", {
  cache_key: text("cache_key").primaryKey(),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  dim: integer("dim").notNull(),
  vector: real("vector").array().notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  last_hit_at: timestamp("last_hit_at", { withTimezone: true }).notNull().defaultNow(),
  hit_count: integer("hit_count").notNull().default(0),
});

// ---------------------------------------------------------------------------
// GitHub integration (PRD-github-integration §9.1–§9.8). Full canonical DDL
// lives in custom/0004_github_integration_g1.sql — this Drizzle mirror gives
// app code typed access. Every table is RLS-protected (org_isolation policy
// via app_current_org()); `tenant_id` is the alias the PRD uses for orgs.id.
// ---------------------------------------------------------------------------

/** PRD §9.1 — one row per GitHub App installation per tenant. */
export const github_installations = pgTable(
  "github_installations",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    installation_id: bigint("installation_id", { mode: "bigint" }).notNull(),
    github_org_id: bigint("github_org_id", { mode: "bigint" }).notNull(),
    github_org_login: text("github_org_login").notNull(),
    app_id: bigint("app_id", { mode: "bigint" }).notNull(),
    /** 'active' | 'suspended' | 'revoked' | 'reconnecting' */
    status: text("status").notNull(),
    token_ref: text("token_ref").notNull(),
    webhook_secret_active_ref: text("webhook_secret_active_ref").notNull(),
    /** D55 — dual-accept rotation. Populated for 10-minute window during rotation. */
    webhook_secret_previous_ref: text("webhook_secret_previous_ref"),
    webhook_secret_rotated_at: timestamp("webhook_secret_rotated_at", { withTimezone: true }),
    last_reconciled_at: timestamp("last_reconciled_at", { withTimezone: true }),
    installed_at: timestamp("installed_at", { withTimezone: true }).notNull().defaultNow(),
    suspended_at: timestamp("suspended_at", { withTimezone: true }),
    revoked_at: timestamp("revoked_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantStatusIdx: index("gh_inst_tenant_status_idx").on(table.tenant_id, table.status),
  }),
);

/** PRD §9.2 — PR state per tenant/repo/pr_number. title_hash is sha256, never raw. */
export const github_pull_requests = pgTable(
  "github_pull_requests",
  {
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    provider: text("provider").notNull().default("github"),
    provider_repo_id: varchar("provider_repo_id", { length: 32 }).notNull(),
    pr_number: integer("pr_number").notNull(),
    pr_node_id: text("pr_node_id").notNull(),
    /** 'open' | 'closed' | 'merged' */
    state: text("state").notNull(),
    draft: boolean("draft").notNull().default(false),
    /** sha256(title); never raw title (PRD §Security). */
    title_hash: bytea("title_hash").notNull(),
    base_ref: text("base_ref").notNull(),
    head_ref: text("head_ref").notNull(),
    head_sha: char("head_sha", { length: 40 }).notNull(),
    merge_commit_sha: char("merge_commit_sha", { length: 40 }),
    /** hmac(tenant_salt, login); never raw login. */
    author_login_hash: bytea("author_login_hash").notNull(),
    author_association: text("author_association"),
    additions: integer("additions").notNull().default(0),
    deletions: integer("deletions").notNull().default(0),
    changed_files: integer("changed_files").notNull().default(0),
    commits_count: integer("commits_count").notNull().default(0),
    opened_at: timestamp("opened_at", { withTimezone: true }).notNull(),
    closed_at: timestamp("closed_at", { withTimezone: true }),
    merged_at: timestamp("merged_at", { withTimezone: true }),
    ingested_at: timestamp("ingested_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // biome-ignore lint/suspicious/noExplicitAny: drizzle primaryKey helper typed loosely
  (_table): Record<string, any> => ({}),
);

/** PRD §9.3 — check-suite summary per tenant/repo/head_sha/suite_id. */
export const github_check_suites = pgTable("github_check_suites", {
  tenant_id: uuid("tenant_id")
    .notNull()
    .references(() => orgs.id, { onDelete: "cascade" }),
  provider_repo_id: varchar("provider_repo_id", { length: 32 }).notNull(),
  head_sha: char("head_sha", { length: 40 }).notNull(),
  suite_id: bigint("suite_id", { mode: "bigint" }).notNull(),
  /** 'queued' | 'in_progress' | 'completed' */
  status: text("status").notNull(),
  /** nullable until completed; one of the 8 GitHub conclusions. */
  conclusion: text("conclusion"),
  runs_count: integer("runs_count").notNull().default(0),
  failed_runs_count: integer("failed_runs_count").notNull().default(0),
  started_at: timestamp("started_at", { withTimezone: true }),
  completed_at: timestamp("completed_at", { withTimezone: true }),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** PRD §9.4 — deployment state per tenant/repo/deployment_id. */
export const github_deployments = pgTable("github_deployments", {
  tenant_id: uuid("tenant_id")
    .notNull()
    .references(() => orgs.id, { onDelete: "cascade" }),
  provider_repo_id: varchar("provider_repo_id", { length: 32 }).notNull(),
  deployment_id: bigint("deployment_id", { mode: "bigint" }).notNull(),
  environment: text("environment").notNull(),
  sha: char("sha", { length: 40 }).notNull(),
  ref: text("ref").notNull(),
  /** 'pending'|'queued'|'in_progress'|'success'|'failure'|'error'|'inactive' */
  status: text("status").notNull(),
  first_success_at: timestamp("first_success_at", { withTimezone: true }),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** PRD §9.5 — parsed CODEOWNERS state (D47 input). */
export const github_code_owners = pgTable("github_code_owners", {
  tenant_id: uuid("tenant_id")
    .notNull()
    .references(() => orgs.id, { onDelete: "cascade" }),
  provider_repo_id: varchar("provider_repo_id", { length: 32 }).notNull(),
  ref: text("ref").notNull(),
  content_sha256: bytea("content_sha256").notNull(),
  /** [{pattern, owners:[{type:'team'|'user', id_hash}]}] */
  rules: jsonb("rules").notNull(),
  parsed_at: timestamp("parsed_at", { withTimezone: true }).notNull().defaultNow(),
  superseded_at: timestamp("superseded_at", { withTimezone: true }),
});

/** PRD §9.6 — derived session↔repo linkage. Partitioned by RANGE(computed_at);
 *  partitions created monthly by G1-linker cron. D57: evidence is hashes +
 *  counts only, never raw titles/messages/logins. */
export const session_repo_links = pgTable("session_repo_links", {
  tenant_id: uuid("tenant_id").notNull(),
  session_id: uuid("session_id").notNull(),
  repo_id_hash: bytea("repo_id_hash").notNull(),
  /** 'direct_repo' | 'commit_link' | 'pr_link' | 'deployment_link' */
  match_reason: text("match_reason").notNull(),
  provider_repo_id: varchar("provider_repo_id", { length: 32 }).notNull(),
  evidence: jsonb("evidence").notNull(),
  confidence: smallint("confidence").notNull(),
  inputs_sha256: bytea("inputs_sha256").notNull(),
  computed_at: timestamp("computed_at", { withTimezone: true }).notNull(),
  stale_at: timestamp("stale_at", { withTimezone: true }),
});

/** PRD §9.7 — physical eligibility table (D54). Written same-txn as links. */
export const session_repo_eligibility = pgTable("session_repo_eligibility", {
  tenant_id: uuid("tenant_id")
    .notNull()
    .references(() => orgs.id, { onDelete: "cascade" }),
  session_id: uuid("session_id").notNull(),
  effective_at: timestamp("effective_at", { withTimezone: true }).notNull(),
  eligibility_reasons: jsonb("eligibility_reasons").notNull(),
  eligible: boolean("eligible").notNull(),
  inputs_sha256: bytea("inputs_sha256").notNull(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** PRD §9.8 — rename/transfer/salt-rotation provenance. Retirement worker
 *  lives in G1-linker (not this PR) and honors retires_at + archived_at. */
export const repo_id_hash_aliases = pgTable("repo_id_hash_aliases", {
  tenant_id: uuid("tenant_id")
    .notNull()
    .references(() => orgs.id, { onDelete: "cascade" }),
  old_hash: bytea("old_hash").notNull(),
  new_hash: bytea("new_hash").notNull(),
  /** 'rename' | 'transfer' | 'salt_rotation' | 'provider_change' */
  reason: text("reason").notNull(),
  migrated_at: timestamp("migrated_at", { withTimezone: true }).notNull().defaultNow(),
  retires_at: timestamp("retires_at", { withTimezone: true }).notNull(),
  archived_at: timestamp("archived_at", { withTimezone: true }),
});

/** PRD §13 Phase G1 step 2b — initial-sync progress. One row per
 *  (tenant_id, installation_id). Written by the initial-sync worker;
 *  read by `/api/admin/github/connection`. */
export const github_sync_progress = pgTable("github_sync_progress", {
  tenant_id: uuid("tenant_id")
    .notNull()
    .references(() => orgs.id, { onDelete: "cascade" }),
  installation_id: bigint("installation_id", { mode: "bigint" }).notNull(),
  /** 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' */
  status: text("status").notNull(),
  total_repos: integer("total_repos"),
  fetched_repos: integer("fetched_repos").notNull().default(0),
  pages_fetched: integer("pages_fetched").notNull().default(0),
  /** Opaque GitHub pagination cursor (next `page` integer or full URL). */
  next_page_cursor: text("next_page_cursor"),
  started_at: timestamp("started_at", { withTimezone: true }),
  completed_at: timestamp("completed_at", { withTimezone: true }),
  last_progress_at: timestamp("last_progress_at", { withTimezone: true }).notNull().defaultNow(),
  last_error: text("last_error"),
  retry_count: integer("retry_count").notNull().default(0),
  requested_by: uuid("requested_by").references(() => users.id, { onDelete: "set null" }),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
