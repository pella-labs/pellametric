// @bematist/api — server-side data-access layer for the Bematist dashboard.
//
// Pure functions: each query/mutation takes a `Ctx` (auth + clients) and a
// zod-validated input, returns a typed output. No HTTP transport lives here;
// `apps/web` wraps these functions in Server Actions (mutations) and Route
// Handlers (client-fetched reads, SSE, CSV) per contract 07.

export {
  AuthError,
  assertRole,
  type ClickHouseClient,
  type Ctx,
  type PgClient,
  type RedisClient,
  type Role,
} from "./auth";
export { isComplianceEnabled, useFixtures } from "./env";
export {
  applyDisplayGate,
  Display,
  DisplaySuppression,
  type GateInput,
  K_ANONYMITY_FLOOR,
  MIN_ACTIVE_DAYS,
  MIN_COHORT,
  MIN_OUTCOME_EVENTS,
  MIN_SESSIONS,
} from "./gates";
export {
  type EngineerViewAttemptInput,
  type EngineerViewAttemptOutput,
  recordEngineerViewAttempt,
} from "./mutations/engineer_view";
export { dismissAdminBanner } from "./mutations/github/dismissBanner";
export { enqueueGithubHistoryBackfill } from "./mutations/github/historyBackfill";
export { patchRepoProdEnvRegex } from "./mutations/github/prodEnvRegex";
export {
  type RedeliveryDeps,
  type RedeliveryHttpClient,
  redeliverWebhooks,
} from "./mutations/github/redeliver";
export {
  type PatchRepoTrackingDeps,
  patchRepoTracking,
  type RecomputeScopedEmitter,
} from "./mutations/github/repoTracking";
export { rotateWebhookSecret } from "./mutations/github/rotateWebhookSecret";
export { enqueueGithubSync } from "./mutations/github/sync";
export {
  type PatchTrackingModeDeps,
  patchTrackingMode,
  type RecomputeEmitter,
} from "./mutations/github/trackingMode";
export { setNotificationPref } from "./mutations/policy";
// Mutations
export { revealSession } from "./mutations/session";
export { listAlerts } from "./queries/alerts";
export { getMyViewHistory } from "./queries/audit";
export {
  CLUSTER_CONTRIBUTOR_FLOOR,
  findSessionTwins,
  listClusterContributors,
  listClusters,
} from "./queries/cluster";
// Queries
export { getSummary } from "./queries/dashboard";
export { getGithubAdminBanners } from "./queries/github/banners";
export { getGithubConnection } from "./queries/github/connection";
export { listGithubRepos } from "./queries/github/repos";
export { getTrackingPreview } from "./queries/github/trackingPreview";
export {
  createIngestKey,
  listIngestKeys,
  listOrgDevelopers,
  revokeIngestKey,
} from "./queries/ingestKeys";
export { filterByConfidence, getWeeklyDigest } from "./queries/insights";
export {
  acceptInviteByToken,
  createInvite,
  getInvitePreview,
  listInvites,
  revokeInvite,
} from "./queries/invites";
export {
  activityOverview,
  codeDelivery,
  cohortFilters,
  sessionDetail,
  sessionsFeed,
} from "./queries/new-dashboard";
export {
  perCommitOutcomes,
  perDevOutcomes,
  perPROutcomes,
} from "./queries/outcomes";
export { getEffectivePolicy } from "./queries/policy";
export { getSession, listSessions } from "./queries/session";
export { getTwoByTwo, listTeams } from "./queries/team";
// Schemas — single source of truth for inputs + outputs across Server Actions,
// Route Handlers, RSC, and the CLI.
export * as schemas from "./schemas";
