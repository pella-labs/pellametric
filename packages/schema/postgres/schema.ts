import { sql } from "drizzle-orm";
import {
  boolean,
  char,
  index,
  integer,
  jsonb,
  pgTable,
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
  stable_hash: text("stable_hash").notNull().unique(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// SPRINT1_DRAFT_NEEDS_JORGE_REVIEW — paired with migration 0001_sprint1_auth.sql.
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

// SPRINT1_DRAFT_NEEDS_JORGE_REVIEW — paired with migration 0002_sprint1_policies.sql.
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
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// SPRINT1_DRAFT_NEEDS_JORGE_REVIEW — paired with migration
// 0003_sprint1_git_events.sql. Written by apps/ingest/src/webhooks/router.ts
// (webhooks) and apps/ingest/src/github-app/reconcile.ts (daily cron). UNIQUE
// constraint on pr_node_id gives the row-level dedup layer in D-S1-17.
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
