import {
  pgTable, text, timestamp, integer, bigint, boolean,
  uuid, jsonb, index, uniqueIndex, primaryKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// ---------- better-auth core tables ----------
// Names & shapes per https://www.better-auth.com/docs/concepts/database

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  // extras we attach for convenience
  githubLogin: text("github_login"),
  githubId: text("github_id"),
  gitlabUsername: text("gitlab_username"),
  gitlabId: text("gitlab_id"),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  token: text("token").notNull().unique(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ---------- app tables ----------

export const org = pgTable("org", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Provider discriminator. New columns and code branch on this.
  provider: text("provider").notNull().default("github"),  // 'github' | 'gitlab'
  // External provider identity. Stored as text (matches existing data; GitHub/GitLab both expose numeric ids).
  // Nullable for the inactive provider on each row.
  githubOrgId: text("github_org_id"),                       // present when provider='github'
  gitlabGroupId: text("gitlab_group_id"),                   // present when provider='gitlab'
  gitlabGroupPath: text("gitlab_group_path"),               // full_path, e.g. "pella-labs/team-a"
  slug: text("slug").notNull(),                             // single-segment for github, possibly multi-segment for gitlab
  name: text("name").notNull(),
  promptRetentionDays: integer("prompt_retention_days").notNull().default(30),
  promptRetentionUpdatedAt: timestamp("prompt_retention_updated_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  // GitHub App install — present once an org owner installs the app on this org.
  githubAppInstallationId: bigint("github_app_installation_id", { mode: "number" }),
  githubAppInstalledAt: timestamp("github_app_installed_at"),
  // Insights revamp: Phase 7 hygiene metric (P31/C6). 'required'|'forbidden'|'optional'.
  aiFooterPolicy: text("ai_footer_policy").notNull().default("optional"),
  // Insights revamp: Cursor opt-in flag for session-join attribution inference (P31).
  useCursor: boolean("use_cursor").notNull().default(false),
}, t => ({
  // Same slug across different providers is allowed.
  providerSlugUniq: uniqueIndex("org_provider_slug_uniq").on(t.provider, t.slug),
  // Partial uniques: each provider's external id is unique per provider.
  providerGithubIdUniq: uniqueIndex("org_provider_github_id_uniq")
    .on(t.provider, t.githubOrgId)
    .where(sql`${t.provider} = 'github'`),
  providerGitlabIdUniq: uniqueIndex("org_provider_gitlab_id_uniq")
    .on(t.provider, t.gitlabGroupId)
    .where(sql`${t.provider} = 'gitlab'`),
}));

// Per-org provider credentials (GitLab GAT today; future: bitbucket OAuth, github PAT, …).
// One row per (org_id, kind). Rotation = insert new + delete old in a transaction.
// `tokenEnc` reuses the AES-256-GCM envelope from lib/crypto/prompts.ts (iv.tag.ciphertext).
export const orgCredentials = pgTable("org_credentials", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => org.id, { onDelete: "cascade" }),
  /**
   * Credential kind — drives which other columns are populated:
   *   'gitlab_gat'        → tokenEnc=GAT/PAT plaintext, scopes set, no refresh token
   *   'gitlab_oauth_app'  → tokenEnc=access token, refreshTokenEnc, clientId, clientSecretEnc, refresh/access expiry
   *   (future: 'github_pat', 'bitbucket_oauth', …)
   */
  kind: text("kind").notNull(),
  /** Provider's bearer token (PAT or OAuth access_token). Always populated. */
  tokenEnc: text("token_enc").notNull(),
  /**
   * Comma-separated provider scopes this credential was granted at issue time
   * (e.g. "read_api,api"). Used by the UI to gate write-flow features (invites,
   * MR comments). NULL means unknown — treat as minimal-scope.
   */
  scopes: text("scopes"),
  /** Access-token expiry (OAuth: ~2h, refreshable; GAT/PAT: ~1y, not refreshable). */
  expiresAt: timestamp("expires_at"),
  lastUsedAt: timestamp("last_used_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  // ----- OAuth-application columns (only populated for kind='gitlab_oauth_app') -----
  /** Public OAuth client_id of the customer's GitLab Application. */
  clientId: text("client_id"),
  /** OAuth client_secret, encrypted. */
  clientSecretEnc: text("client_secret_enc"),
  /** OAuth refresh_token, encrypted. Used to mint new access tokens. */
  refreshTokenEnc: text("refresh_token_enc"),
  /** Refresh-token expiry. NULL = no documented expiry. */
  refreshExpiresAt: timestamp("refresh_expires_at"),
  /**
   * Webhook secret for HMAC verification of inbound events for this org.
   * Generated at OAuth-app connect time, sent to GitLab when registering hooks.
   * Encrypted at rest because it grants the ability to forge events to us.
   */
  webhookSecretEnc: text("webhook_secret_enc"),
}, t => ({
  uniq: uniqueIndex("org_credentials_org_kind_uniq").on(t.orgId, t.kind),
}));

// role: "manager" can invite + view all; "dev" sees own + shared org rollups
export const membership = pgTable("membership", {
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  orgId: uuid("org_id").notNull().references(() => org.id, { onDelete: "cascade" }),
  role: text("role").notNull(),                  // "manager" | "dev"
  joinedAt: timestamp("joined_at").notNull().defaultNow(),
}, t => ({
  pk: primaryKey({ columns: [t.userId, t.orgId] }),
  byOrg: index("membership_by_org").on(t.orgId),
}));

// Append-only audit log for role changes. Insert one row per promote/demote.
export const membershipAudit = pgTable("membership_audit", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => org.id, { onDelete: "cascade" }),
  targetUserId: text("target_user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  actorUserId: text("actor_user_id").notNull().references(() => user.id),
  fromRole: text("from_role").notNull(),
  toRole: text("to_role").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, t => ({
  byOrg: index("membership_audit_by_org").on(t.orgId, t.createdAt),
}));

export const invitation = pgTable("invitation", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => org.id, { onDelete: "cascade" }),
  githubLogin: text("github_login").notNull(),
  invitedByUserId: text("invited_by").notNull().references(() => user.id),
  role: text("role").notNull().default("dev"),          // "manager" | "dev"
  status: text("status").notNull().default("pending"),  // "pending" | "accepted" | "revoked"
  createdAt: timestamp("created_at").notNull().defaultNow(),
  acceptedAt: timestamp("accepted_at"),
}, t => ({
  uniq: uniqueIndex("invite_org_login_uniq").on(t.orgId, t.githubLogin),
}));

// API token the collector uses to upload
export const apiToken = pgTable("api_token", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  name: text("name").notNull().default("collector"),
  tokenHash: text("token_hash").notNull().unique(),  // store sha256, not plaintext
  lastUsedAt: timestamp("last_used_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  revokedAt: timestamp("revoked_at"),
});

// ---------- session data (uploads) ----------

// One row per Claude Code or Codex session (already merged at collector).
export const sessionEvent = pgTable("session_event", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  orgId: uuid("org_id").notNull().references(() => org.id, { onDelete: "cascade" }),
  provider: text("provider").notNull().default("github"),  // 'github' | 'gitlab' — matches org.provider
  source: text("source").notNull(),              // "claude" | "codex"
  externalSessionId: text("external_session_id").notNull(),
  repo: text("repo").notNull(),                  // ownerPath/name (slashes allowed in ownerPath for gitlab subgroups)
  cwd: text("cwd"),
  // Insights revamp (P9): branch from `git rev-parse --abbrev-ref HEAD` at session start.
  branch: text("branch"),
  // Insights revamp (P14): collector's resolved repo from cwd walk-up (owner/name).
  cwdResolvedRepo: text("cwd_resolved_repo"),
  startedAt: timestamp("started_at").notNull(),
  endedAt: timestamp("ended_at").notNull(),
  model: text("model"),
  tokensIn: bigint("tokens_in", { mode: "number" }).notNull().default(0),
  tokensOut: bigint("tokens_out", { mode: "number" }).notNull().default(0),
  tokensCacheRead: bigint("tokens_cache_read", { mode: "number" }).notNull().default(0),
  tokensCacheWrite: bigint("tokens_cache_write", { mode: "number" }).notNull().default(0),
  tokensReasoning: bigint("tokens_reasoning", { mode: "number" }).notNull().default(0),
  messages: integer("messages").notNull().default(0),
  userTurns: integer("user_turns").notNull().default(0),
  errors: integer("errors").notNull().default(0),
  filesEdited: jsonb("files_edited").notNull().default([]),        // string[]
  toolHist: jsonb("tool_hist").notNull().default({}),              // Record<string,number>
  skillsUsed: jsonb("skills_used").notNull().default([]),          // string[]
  mcpsUsed: jsonb("mcps_used").notNull().default([]),              // string[]
  intentTop: text("intent_top"),
  isSidechain: boolean("is_sidechain").notNull().default(false),
  teacherMoments: integer("teacher_moments").notNull().default(0),
  frustrationSpikes: integer("frustration_spikes").notNull().default(0),
  promptWordsMedian: integer("prompt_words_median").notNull().default(0),
  promptWordsP95: integer("prompt_words_p95").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, t => ({
  byUser: index("sess_by_user").on(t.userId, t.startedAt),
  byOrg: index("sess_by_org").on(t.orgId, t.startedAt),
  byRepo: index("sess_by_repo").on(t.orgId, t.repo, t.startedAt),
  uniqExternal: uniqueIndex("sess_uniq_external").on(t.userId, t.source, t.externalSessionId),
}));

// PRs (GitHub) / MRs (GitLab) pulled via provider API for each org. Cached.
export const pr = pgTable("pr", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => org.id, { onDelete: "cascade" }),
  provider: text("provider").notNull().default("github"),  // 'github' | 'gitlab'
  repo: text("repo").notNull(),                  // ownerPath/name
  number: integer("number").notNull(),
  title: text("title"),
  authorLogin: text("author_login"),
  state: text("state").notNull(),                // "open" | "closed" | "merged"
  additions: integer("additions").notNull().default(0),
  deletions: integer("deletions").notNull().default(0),
  changedFiles: integer("changed_files").notNull().default(0),
  commits: integer("commits").notNull().default(0),
  createdAt: timestamp("created_at").notNull(),
  mergedAt: timestamp("merged_at"),
  url: text("url"),
  fileList: jsonb("file_list").notNull().default([]), // string[]
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  // Insights revamp additions (P5, P11)
  mergeCommitSha: text("merge_commit_sha"),
  baseBranch: text("base_branch"),
  headBranch: text("head_branch"),
  lastSyncedAt: timestamp("last_synced_at").notNull().defaultNow(),
  linkComputedAt: timestamp("link_computed_at"),
  kind: text("kind").notNull().default("standard"),   // 'standard' | 'revert'
  revertsPrId: uuid("reverts_pr_id"),
  stackedOn: uuid("stacked_on"),
  // C5 fix (P10): renamed-away filenames captured from /pulls/N/files
  // `previous_filename` field. Threaded into scoreLineage so sessions that
  // edited a file before it was renamed still get a Jaccard hit.
  previousFilenames: jsonb("previous_filenames").notNull().default([]),
}, t => ({
  byOrg: index("pr_by_org").on(t.orgId, t.createdAt),
  uniqPr: uniqueIndex("pr_uniq").on(t.orgId, t.repo, t.number),
  byMergedAt: index("pr_by_merged_at")
    .on(t.orgId, t.mergedAt)
    .where(sql`${t.state} = 'merged'`),
  byHeadBranch: index("pr_by_head_branch").on(t.orgId, t.repo, t.headBranch),
}));

export const sessionPrLink = pgTable("session_pr_link", {
  sessionEventId: uuid("session_event_id").notNull().references(() => sessionEvent.id, { onDelete: "cascade" }),
  prId: uuid("pr_id").notNull().references(() => pr.id, { onDelete: "cascade" }),
  fileOverlap: integer("file_overlap").notNull().default(0),
  confidence: text("confidence").notNull().default("medium"),  // "high" | "medium" | "low"
  createdAt: timestamp("created_at").notNull().defaultNow(),
  // Insights revamp enrichment (P10)
  fileJaccard: integer("file_jaccard").notNull().default(0),                // 0..100
  timeOverlap: text("time_overlap").notNull().default("none"),              // 'within_pr_window'|'pre_pr'|'post_pr'|'none'
  cwdMatch: boolean("cwd_match").notNull().default(false),
  branchMatch: boolean("branch_match").notNull().default(false),
  confidenceScore: integer("confidence_score").notNull().default(0),        // 0..100
  confidenceReason: jsonb("confidence_reason").notNull().default({}),       // {signals,weights,formula}
  linkSource: text("link_source").notNull().default("auto"),                // 'auto'|'manual_dev'|'manual_manager'
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, t => ({
  pk: primaryKey({ columns: [t.sessionEventId, t.prId] }),
  byPr: index("link_by_pr").on(t.prId),
  byConfidence: index("link_by_confidence").on(t.prId, t.confidence),
}));

// ---------- encrypted prompts ----------
// Per-user data-encryption-key, wrapped with the server master key.
// Wrapped form = iv(12B base64) | "." | tag(16B base64) | "." | ciphertext(base64).
export const userPromptKey = pgTable("user_prompt_key", {
  userId: text("user_id").primaryKey().references(() => user.id, { onDelete: "cascade" }),
  keyEnc: text("key_enc").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// One row per individual user prompt. Encrypted with the owner's DEK (AES-256-GCM).
// Only the owning user can ever decrypt via the API; managers see only aggregates.
export const promptEvent = pgTable("prompt_event", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  orgId: uuid("org_id").notNull().references(() => org.id, { onDelete: "cascade" }),
  source: text("source").notNull(),                 // "claude" | "codex"
  externalSessionId: text("external_session_id").notNull(),
  tsPrompt: timestamp("ts_prompt").notNull(),
  wordCount: integer("word_count").notNull().default(0),
  iv: text("iv").notNull(),
  tag: text("tag").notNull(),
  ciphertext: text("ciphertext").notNull(),
  expiresAt: timestamp("expires_at").notNull().default(sql`now() + interval '30 days'`),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, t => ({
  byUserSession: index("prompt_by_user_session").on(t.userId, t.externalSessionId, t.tsPrompt),
  byExpiresAt: index("prompt_by_expires_at").on(t.expiresAt),
  // Dedup the same prompt on re-ingest: (user,source,external,timestamp) is unique.
  uniq: uniqueIndex("prompt_uniq").on(t.userId, t.source, t.externalSessionId, t.tsPrompt),
}));

// One row per assistant text response. Same encryption + owner-only access
// model as promptEvent. Managers/aggregates never touch these rows.
export const responseEvent = pgTable("response_event", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  orgId: uuid("org_id").notNull().references(() => org.id, { onDelete: "cascade" }),
  source: text("source").notNull(),
  externalSessionId: text("external_session_id").notNull(),
  tsResponse: timestamp("ts_response").notNull(),
  wordCount: integer("word_count").notNull().default(0),
  iv: text("iv").notNull(),
  tag: text("tag").notNull(),
  ciphertext: text("ciphertext").notNull(),
  expiresAt: timestamp("expires_at").notNull().default(sql`now() + interval '30 days'`),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, t => ({
  byUserSession: index("response_by_user_session").on(t.userId, t.externalSessionId, t.tsResponse),
  byExpiresAt: index("response_by_expires_at").on(t.expiresAt),
  uniq: uniqueIndex("response_uniq").on(t.userId, t.source, t.externalSessionId, t.tsResponse),
}));

// Ingest batch record for idempotency + audit
export const uploadBatch = pgTable("upload_batch", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  orgId: uuid("org_id").notNull().references(() => org.id, { onDelete: "cascade" }),
  source: text("source").notNull(),              // "claude" | "codex"
  sessionCount: integer("session_count").notNull().default(0),
  rowsInserted: integer("rows_inserted").notNull().default(0),
  collectorVersion: text("collector_version"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ---------- /card flow tables ----------
// Accessed via raw SQL from app/api/card/* routes — this definition exists
// only so drizzle-kit push knows the tables are intentional. Column shapes
// and the PK-only index set match prod exactly; no FKs in prod either.

export const cardTokens = pgTable("card_tokens", {
  tokenHash: text("token_hash").primaryKey(),
  subjectKind: text("subject_kind").notNull(),       // 'better_auth_user' | 'github_star'
  subjectId: text("subject_id").notNull(),
  githubUsername: text("github_username"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const cards = pgTable("cards", {
  cardId: text("card_id").primaryKey(),
  ownerUserId: text("owner_user_id"),
  githubUsername: text("github_username"),
  displayName: text("display_name"),
  avatarUrl: text("avatar_url"),
  stats: jsonb("stats").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------- Insights revamp (Phase 1) ----------

// Token pricing source of truth (P7). Cost computed at read time via priceFor().
export const modelPricing = pgTable("model_pricing", {
  id: uuid("id").primaryKey().defaultRandom(),
  model: text("model").notNull(),
  effectiveFrom: timestamp("effective_from").notNull(),
  effectiveTo: timestamp("effective_to"),
  inputCentiPerMtok: integer("input_centi_per_mtok").notNull(),
  outputCentiPerMtok: integer("output_centi_per_mtok").notNull(),
  cacheReadCentiPerMtok: integer("cache_read_centi_per_mtok").notNull().default(0),
  cacheWriteCentiPerMtok: integer("cache_write_centi_per_mtok").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, t => ({
  uniq: uniqueIndex("model_pricing_model_from_uniq").on(t.model, t.effectiveFrom),
  byModel: index("model_pricing_by_model").on(t.model, t.effectiveFrom),
}));

// Per-commit AI source attribution + redacted message (P2, P4, P6, P20).
export const prCommit = pgTable("pr_commit", {
  id: uuid("id").primaryKey().defaultRandom(),
  prId: uuid("pr_id").notNull().references(() => pr.id, { onDelete: "cascade" }),
  orgId: uuid("org_id").notNull().references(() => org.id, { onDelete: "cascade" }),
  sha: text("sha").notNull(),
  authorLogin: text("author_login"),
  authorEmail: text("author_email"),
  authorName: text("author_name"),
  committerEmail: text("committer_email"),
  message: text("message").notNull().default(""),
  messageRedacted: boolean("message_redacted").notNull().default(false),
  additions: integer("additions").notNull().default(0),
  deletions: integer("deletions").notNull().default(0),
  fileList: jsonb("file_list").notNull().default([]),
  authoredAt: timestamp("authored_at").notNull(),
  kind: text("kind").notNull().default("commit"),    // 'commit'|'squash_merge'|'merge_commit'
  aiSources: text("ai_sources").array().notNull().default(sql`'{}'::text[]`),
  aiSignals: jsonb("ai_signals").notNull().default({}),
  aiConfidence: integer("ai_confidence").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, t => ({
  uniq: uniqueIndex("pr_commit_uniq").on(t.prId, t.sha),
  byOrgAuthor: index("pr_commit_by_org_author").on(t.orgId, t.authorLogin, t.authoredAt),
  byOrgAi: index("pr_commit_by_org_ai").on(t.orgId, t.authoredAt),
}));

// Lineage worker queue (P15). Lower priority int = higher priority.
export const lineageJob = pgTable("lineage_job", {
  id: uuid("id").primaryKey().defaultRandom(),
  prId: uuid("pr_id").notNull().references(() => pr.id, { onDelete: "cascade" }),
  reason: text("reason").notNull(),
  priority: integer("priority").notNull().default(5),
  scheduledFor: timestamp("scheduled_for").notNull().defaultNow(),
  status: text("status").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, t => ({
  byStatusSched: index("lineage_job_by_status_sched").on(t.status, t.scheduledFor),
  byPr: index("lineage_job_by_pr").on(t.prId),
}));

// Worker heartbeat (P16). Upserted on every run; /api/health/lineage reads it.
export const systemHealth = pgTable("system_health", {
  component: text("component").primaryKey(),
  lastRunAt: timestamp("last_run_at").notNull().defaultNow(),
  lastRunStatus: text("last_run_status").notNull(),
  payload: jsonb("payload").notNull().default({}),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Persisted rollups — tokens only; cost computed at read time.
export const dailyUserStats = pgTable("daily_user_stats", {
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  orgId: uuid("org_id").notNull().references(() => org.id, { onDelete: "cascade" }),
  day: text("day").notNull(),
  source: text("source").notNull(),
  sessions: integer("sessions").notNull().default(0),
  activeHoursCenti: integer("active_hours_centi").notNull().default(0),
  tokensIn: bigint("tokens_in", { mode: "number" }).notNull().default(0),
  tokensOut: bigint("tokens_out", { mode: "number" }).notNull().default(0),
  tokensCacheRead: bigint("tokens_cache_read", { mode: "number" }).notNull().default(0),
  tokensCacheWrite: bigint("tokens_cache_write", { mode: "number" }).notNull().default(0),
  messages: integer("messages").notNull().default(0),
  errors: integer("errors").notNull().default(0),
  teacherMoments: integer("teacher_moments").notNull().default(0),
  frustrationSpikes: integer("frustration_spikes").notNull().default(0),
  computedAt: timestamp("computed_at").notNull().defaultNow(),
}, t => ({
  pk: primaryKey({ columns: [t.userId, t.orgId, t.day, t.source] }),
  byOrgDay: index("daily_user_stats_by_org_day").on(t.orgId, t.day),
}));

export const dailyOrgStats = pgTable("daily_org_stats", {
  orgId: uuid("org_id").notNull().references(() => org.id, { onDelete: "cascade" }),
  day: text("day").notNull(),
  source: text("source").notNull(),
  sessions: integer("sessions").notNull().default(0),
  activeHoursCenti: integer("active_hours_centi").notNull().default(0),
  tokensIn: bigint("tokens_in", { mode: "number" }).notNull().default(0),
  tokensOut: bigint("tokens_out", { mode: "number" }).notNull().default(0),
  tokensCacheRead: bigint("tokens_cache_read", { mode: "number" }).notNull().default(0),
  tokensCacheWrite: bigint("tokens_cache_write", { mode: "number" }).notNull().default(0),
  prsMerged: integer("prs_merged").notNull().default(0),
  prsMergedAiAssisted: integer("prs_merged_ai_assisted").notNull().default(0),
  prsMergedBot: integer("prs_merged_bot").notNull().default(0),
  prsReverted: integer("prs_reverted").notNull().default(0),
  computedAt: timestamp("computed_at").notNull().defaultNow(),
}, t => ({
  pk: primaryKey({ columns: [t.orgId, t.day, t.source] }),
}));

export const costPerPr = pgTable("cost_per_pr", {
  prId: uuid("pr_id").primaryKey().references(() => pr.id, { onDelete: "cascade" }),
  orgId: uuid("org_id").notNull().references(() => org.id, { onDelete: "cascade" }),
  linkedSessions: integer("linked_sessions").notNull().default(0),
  linkedUsers: integer("linked_users").notNull().default(0),
  tokensIn: bigint("tokens_in", { mode: "number" }).notNull().default(0),
  tokensOut: bigint("tokens_out", { mode: "number" }).notNull().default(0),
  tokensCacheRead: bigint("tokens_cache_read", { mode: "number" }).notNull().default(0),
  tokensCacheWrite: bigint("tokens_cache_write", { mode: "number" }).notNull().default(0),
  totalSessionWallSec: integer("total_session_wall_sec").notNull().default(0),
  highConfLinks: integer("high_conf_links").notNull().default(0),
  mediumConfLinks: integer("medium_conf_links").notNull().default(0),
  pctClaude: integer("pct_claude").notNull().default(0),
  pctCodex: integer("pct_codex").notNull().default(0),
  pctCursor: integer("pct_cursor").notNull().default(0),
  pctHuman: integer("pct_human").notNull().default(0),
  pctBot: integer("pct_bot").notNull().default(0),
  priceVersion: integer("price_version").notNull().default(0),
  computedAt: timestamp("computed_at").notNull().defaultNow(),
}, t => ({
  byOrg: index("cost_per_pr_by_org").on(t.orgId, t.computedAt),
}));

// Cohort audit log (P19) — manager queries with hashed cohort membership.
export const cohortQueryLog = pgTable("cohort_query_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  managerId: text("manager_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  orgId: uuid("org_id").notNull().references(() => org.id, { onDelete: "cascade" }),
  metric: text("metric").notNull(),
  cohortHash: text("cohort_hash").notNull(),
  memberIds: text("member_ids").array().notNull(),
  queriedAt: timestamp("queried_at").notNull().defaultNow(),
}, t => ({
  byMgr: index("cohort_query_log_by_mgr").on(t.managerId, t.queriedAt),
  byOrgMetric: index("cohort_query_log_by_org_metric").on(t.orgId, t.metric, t.queriedAt),
}));

// F2.11 — saved insights (PostHog-style builder). Per locked decision §7.3:
// scope='org' rows are visible+editable by every manager in the org; scope='user'
// rows are visible only to their owning user. Dev rows are always scope='user'.
export const savedInsight = pgTable("saved_insight", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => org.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  scope: text("scope").notNull(),  // 'org' | 'user'
  name: text("name").notNull(),
  description: text("description"),
  queryJson: jsonb("query_json").notNull().default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, t => ({
  byOrg: index("saved_insight_by_org").on(t.orgId, t.scope),
  byUser: index("saved_insight_by_user").on(t.userId, t.createdAt),
}));

export const savedDashboard = pgTable("saved_dashboard", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => org.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  scope: text("scope").notNull(),  // 'org' | 'user'
  name: text("name").notNull(),
  layoutJson: jsonb("layout_json").notNull().default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, t => ({
  byOrg: index("saved_dashboard_by_org").on(t.orgId, t.scope),
}));

export const dashboardPinnedInsight = pgTable("dashboard_pinned_insight", {
  dashboardId: uuid("dashboard_id").notNull().references(() => savedDashboard.id, { onDelete: "cascade" }),
  insightId: uuid("insight_id").notNull().references(() => savedInsight.id, { onDelete: "cascade" }),
  position: integer("position").notNull().default(0),
}, t => ({
  pk: primaryKey({ columns: [t.dashboardId, t.insightId] }),
  byDashboard: index("dashboard_pinned_by_dash").on(t.dashboardId, t.position),
}));

// Resumable backfill cursor (P23).
export const backfillState = pgTable("backfill_state", {
  orgId: uuid("org_id").primaryKey().references(() => org.id, { onDelete: "cascade" }),
  lastDay: text("last_day"),
  lastPrId: uuid("last_pr_id"),
  status: text("status").notNull().default("pending"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
