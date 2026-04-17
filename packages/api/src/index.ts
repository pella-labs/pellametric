// @bematist/api — server-side data-access layer for the Bematist dashboard.
//
// Pure functions: each query/mutation takes a `Ctx` (auth + clients) and a
// zod-validated input, returns a typed output. No HTTP transport lives here;
// `apps/web` wraps these functions in Server Actions (mutations) and Route
// Handlers (client-fetched reads, SSE, CSV) per contract 07.

export {
  assertRole,
  AuthError,
  type ClickHouseClient,
  type Ctx,
  type PgClient,
  type RedisClient,
  type Role,
} from "./auth";
export {
  applyDisplayGate,
  Display,
  DisplaySuppression,
  MIN_ACTIVE_DAYS,
  MIN_COHORT,
  MIN_OUTCOME_EVENTS,
  MIN_SESSIONS,
  K_ANONYMITY_FLOOR,
  type GateInput,
} from "./gates";

// Schemas — single source of truth for inputs + outputs across Server Actions,
// Route Handlers, RSC, and the CLI.
export * as schemas from "./schemas";

// Queries
export { getSummary } from "./queries/dashboard";
export { getMyViewHistory } from "./queries/audit";
export { getSession } from "./queries/session";
export { listTeams, getTwoByTwo } from "./queries/team";
export { listClusters, CLUSTER_CONTRIBUTOR_FLOOR } from "./queries/cluster";
export { getWeeklyDigest, filterByConfidence } from "./queries/insights";

// Mutations
export { revealSession } from "./mutations/session";
