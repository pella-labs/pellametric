import { sql } from "drizzle-orm";
import {
  boolean,
  char,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const orgs = pgTable("orgs", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
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

/** HMAC of (repo_full_name, tenant_salt) per contract 09 open Q 2. */
export const repos = pgTable("repos", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  org_id: uuid("org_id")
    .notNull()
    .references(() => orgs.id),
  repo_id_hash: text("repo_id_hash").notNull().unique(),
  provider: text("provider").notNull(), // github | gitlab | bitbucket
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
