import {
  pgTable, text, timestamp, integer, bigint, boolean,
  uuid, jsonb, index, uniqueIndex, primaryKey,
} from "drizzle-orm/pg-core";

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
  githubOrgId: text("github_org_id").notNull().unique(),
  slug: text("slug").notNull().unique(),         // e.g. "pella-labs"
  name: text("name").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  // Pellametric GitHub App install — present once an org owner installs the app on this org.
  // Server-to-server calls (invite, PR fetch) use this installation's tokens instead of a user OAuth token.
  githubAppInstallationId: bigint("github_app_installation_id", { mode: "number" }),
  githubAppInstalledAt: timestamp("github_app_installed_at"),
});

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
  source: text("source").notNull(),              // "claude" | "codex"
  externalSessionId: text("external_session_id").notNull(),
  repo: text("repo").notNull(),                  // owner/name
  cwd: text("cwd"),
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

// PRs pulled via GitHub API for each org (cached)
export const pr = pgTable("pr", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => org.id, { onDelete: "cascade" }),
  repo: text("repo").notNull(),                  // owner/name
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
}, t => ({
  byOrg: index("pr_by_org").on(t.orgId, t.createdAt),
  uniqPr: uniqueIndex("pr_uniq").on(t.orgId, t.repo, t.number),
}));

export const sessionPrLink = pgTable("session_pr_link", {
  sessionEventId: uuid("session_event_id").notNull().references(() => sessionEvent.id, { onDelete: "cascade" }),
  prId: uuid("pr_id").notNull().references(() => pr.id, { onDelete: "cascade" }),
  fileOverlap: integer("file_overlap").notNull().default(0),
  confidence: text("confidence").notNull().default("medium"),  // "high" | "medium" | "low"
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, t => ({
  pk: primaryKey({ columns: [t.sessionEventId, t.prId] }),
  byPr: index("link_by_pr").on(t.prId),
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
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, t => ({
  byUserSession: index("prompt_by_user_session").on(t.userId, t.externalSessionId, t.tsPrompt),
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
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, t => ({
  byUserSession: index("response_by_user_session").on(t.userId, t.externalSessionId, t.tsResponse),
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
