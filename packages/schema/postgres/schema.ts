import { sql } from "drizzle-orm";
import { boolean, integer, jsonb, pgTable, real, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const orgs = pgTable("orgs", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  // Tier-C opt-in flag (managed-cloud gate per CLAUDE.md Security Rules)
  tier_c_managed_cloud_optin: boolean("tier_c_managed_cloud_optin").notNull().default(false),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  org_id: uuid("org_id")
    .notNull()
    .references(() => orgs.id),
  sso_subject: text("sso_subject").notNull().unique(),
  email: text("email").notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

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

/** Per-org redaction overrides + tier config + signed Tier-C config. */
export const policies = pgTable("policies", {
  org_id: uuid("org_id")
    .primaryKey()
    .references(() => orgs.id),
  tier_default: text("tier_default").notNull().default("B"),
  redaction_overrides_json: jsonb("redaction_overrides_json").notNull().default(sql`'{}'::jsonb`),
  tier_c_signed_config: text("tier_c_signed_config"),
  tier_c_activated_at: timestamp("tier_c_activated_at", { withTimezone: true }),
});

/** GitHub-App-mirrored git metadata; denormalized to CH events on write. */
export const git_events = pgTable("git_events", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  org_id: uuid("org_id")
    .notNull()
    .references(() => orgs.id),
  repo_id: uuid("repo_id")
    .notNull()
    .references(() => repos.id),
  kind: text("kind").notNull(), // push | pr | review | workflow_run | check_suite
  commit_sha: text("commit_sha"),
  pr_number: integer("pr_number"),
  branch: text("branch"),
  payload_json: jsonb("payload_json").notNull().default(sql`'{}'::jsonb`),
  ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
});

/** dm_<orgId>_<rand> bearer tokens. Secret stored hashed; prefix kept for UI + lookup. */
export const ingest_keys = pgTable("ingest_keys", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  org_id: uuid("org_id")
    .notNull()
    .references(() => orgs.id),
  key_prefix: text("key_prefix").notNull(),
  hashed_secret: text("hashed_secret").notNull(),
  created_by: uuid("created_by")
    .notNull()
    .references(() => users.id),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  revoked_at: timestamp("revoked_at", { withTimezone: true }),
});

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
 * DB-level rules + trigger enforce this; see audit_log_immutable.sql applied in
 * the same migration set.
 */
export const audit_log = pgTable("audit_log", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
  actor_user_id: uuid("actor_user_id")
    .notNull()
    .references(() => users.id),
  action: text("action").notNull(),
  target_type: text("target_type").notNull(),
  target_id: text("target_id").notNull(),
  reason: text("reason"),
  metadata_json: jsonb("metadata_json").notNull().default(sql`'{}'::jsonb`),
});

/** D30 per-manager-view notification source — IC daily digest reads from here. */
export const audit_events = pgTable("audit_events", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
  actor_user_id: uuid("actor_user_id")
    .notNull()
    .references(() => users.id),
  target_engineer_id_hash: text("target_engineer_id_hash").notNull(),
  surface: text("surface").notNull(), // engineer_page | 2x2 | session_reveal | cluster_page
  session_id_hash: text("session_id_hash"),
});

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
