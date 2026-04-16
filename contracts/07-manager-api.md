# 07 — Manager API (tRPC + SSE)

**Status:** draft
**Owners:** Workstream E (web/dashboard), Workstream C (ingest hosts the API)
**Consumers:** `apps/web` (Next.js dashboard), CLI (`devmetrics outcomes`, `devmetrics waste`, `devmetrics prompts`)
**Last touched:** 2026-04-16

## Purpose

The HTTP/SSE surface the dashboard (and the CLI's read-side commands) call. tRPC v11 because it gives us end-to-end TypeScript types into the Next.js app for free. Schemas live in `packages/api`.

Read-only at v0 — there's no write path that affects analytics from the dashboard. Configuration writes (policy, alerts, ingest keys) go through admin routers (out of scope here, lives in the BSL admin module).

## Routers

```
api.dashboard.*           // top-level summary widgets
api.team.*                // /team/<slug> pages
api.engineer.*            // /me + /engineer/<id> (limited by RBAC)
api.session.*             // /sessions/<id>
api.cluster.*             // prompt clusters and Twin Finder
api.outcomes.*            // PR / commit / test outcomes
api.alerts.*              // anomaly alerts feed
api.insights.*            // weekly insight engine output
api.audit.*               // who-viewed-whom log (Bill of Rights #6)
api.policy.*              // read-only — policy diff for current user/org
```

## Sample procedure shapes

```ts
// packages/api/routers/dashboard.ts (draft)
export const dashboardRouter = router({
  summary: protectedProcedure
    .input(z.object({
      window: z.enum(["7d", "30d", "90d"]),
      team_id: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      // returns { ai_leverage_score, total_cost_usd, accepted_edits, sessions, ... }
      // tiles that fail display gates (04-scoring-io.md) return show: false
    }),

  twoByTwo: protectedProcedure
    .input(z.object({
      team_id: z.string(),
      window: z.enum(["7d", "30d", "90d"]),
      task_category: z.string().optional(),  // for stratified compare
    }))
    .query(async ({ ctx, input }) => {
      // returns { points: { engineer_id_or_dot, x: outcome_quality, y: efficiency, color, revealed }[] }
      // engineer_id only present if revealed=true (IC opted in)
    }),
});

// packages/api/routers/session.ts (draft)
export const sessionRouter = router({
  get: protectedProcedure
    .input(z.object({ session_id: z.string() }))
    .query(async ({ ctx, input }) => {
      // returns Session metadata; prompt_text included only if reveal token presented
    }),

  reveal: protectedProcedure
    .input(z.object({
      session_id: z.string(),
      reason: z.string().min(20),       // free-text reason; logged
    }))
    .mutation(async ({ ctx, input }) => {
      // Step 1: check IC opt-in OR admin signed-config tier-C OR auditor role
      // Step 2: write audit_log entry { actor, target_engineer, session_id, reason, ts }
      // Step 3: write audit_events row (D30) — IC's daily digest will surface
      // Step 4: issue short-lived reveal token (15 min)
      // returns { reveal_token } — caller uses on subsequent .get with includePrompt=true
    }),
});

// packages/api/routers/insights.ts (draft)
export const insightsRouter = router({
  weeklyDigest: protectedProcedure
    .input(z.object({ team_id: z.string(), week: z.string() }))
    .query(async ({ ctx, input }) => {
      // returns { insights: Insight[] } where each insight has confidence: "high"|"medium"|"low"
      // Per CLAUDE.md AI Rules: only High shown; Medium labeled "investigate"; Low never returned.
      // Server filters Low before returning.
    }),
});
```

## SSE channels

For realtime tiles. Bun-native SSE (no socket.io). Authenticated via the same bearer.

| Path | Event payloads | Notes |
|---|---|---|
| `GET /sse/anomalies?team_id=…` | `{ kind: "anomaly", dev_id_hash, signal, value, threshold, ts }` | Hourly anomaly detector pushes here. NEVER per-session real-time (would breach D2 panopticon non-goal). |
| `GET /sse/cost?org_id=…` | `{ kind: "cost_tick", cost_usd_30s, ts }` | Aggregated 30-second buckets, org-level. |
| `GET /sse/collector_health?org_id=…` | `{ kind: "collector", device_id, status, fidelity, version, last_event_at }` | Powers the dashboard's collector-health widget. |

**Banned channels** (ever) — these would require event types we refuse to ship:
- per-engineer event stream
- per-session token-tick
- "live coding feed"

## Authn / Authz

- **Authn:** Better Auth (1.5+). Session cookie or bearer for CLI.
- **Authz:** RBAC roles per `packages/api/auth.ts`:
  - `admin` — full access; can flip tier-C with signed config + cooldown
  - `manager` — team-scoped reads; 2×2 view; CANNOT read IC prompt text without reveal mutation
  - `engineer` — `/me` + own sessions; can opt-in tier-C per project
  - `auditor` — legal-hold reveal; logged
  - `viewer` — read-only summary tiles, no individual data

- **Cross-tenant probe (INT9)** — adversarial test attempts cross-tenant query with each role's token. MUST return 0 rows. Merge blocker.

## Reveal gesture (D8)

Reading IC prompt text requires:
1. **Mutation `session.reveal`** with non-empty reason.
2. **Server-side check** of one of three conditions:
   - IC opted in to project-scope tier C; OR
   - Admin flipped tenant-wide signed config + 7d cooldown elapsed + IC banner shown; OR
   - Auditor role + legal-hold flag set.
3. **Audit row** `audit_log` (immutable) AND `audit_events` row (per-manager-view, D30).
4. **Reveal token** valid 15 min, single-session.

Without the token, `session.get` returns `prompt_text: null` with `redacted_reason: "consent_required"`.

## CSV export rules

- Default export: `prompt_text` and `tool_input/tool_output` columns omitted.
- `?include_prompts=true` requires:
  - 2FA challenge passed in the last 5 min.
  - `audit_log` entry written.
  - Per-row reveal-eligibility check (server enforces; client request is not the boundary).

## Error model

tRPC standard codes:
- `UNAUTHORIZED` — no session
- `FORBIDDEN` — RBAC fail or tier-C without opt-in
- `NOT_FOUND` — scope_id doesn't exist or RLS blocked
- `BAD_REQUEST` — zod validation
- `TOO_MANY_REQUESTS` — Redis token bucket exhausted
- `INTERNAL_SERVER_ERROR` — log + Sentry breadcrumb

## Performance gates

- p95 dashboard latency **<2s** with 1M seeded events (PRD §10).
- Read paths use ClickHouse materialized views, not raw `events`. `EXPLAIN` checked for projection use.

## Invariants

1. **Read-only.** Mutations exist only for reveal/opt-in/policy — never for analytics writes.
2. **RBAC enforced server-side.** Frontend role checks are UX, not security.
3. **Reveal gesture is the ONLY path to prompt_text.** Direct queries that return prompt text without a valid reveal token fail.
4. **Display gates (`04-scoring-io.md`) honored at the API layer.** If `display.show=false`, the procedure returns the suppression reason; frontend renders "insufficient data — gate X". The server doesn't ship a number that the gate said shouldn't ship.
5. **Insight confidence filtering server-side** — Low-confidence insights are dropped before the response leaves the server. Frontend never sees them.
6. **No SSE channel that would constitute a "real-time per-engineer event feed"** (panopticon non-goal).

## Open questions

- Do we expose a stable REST API (OpenAPI) for tooling, or stay tRPC-only? (Owner: E + C — recommend tRPC for the Next.js dashboard, generate an OpenAPI spec from the same routers for non-TS consumers.)
- Reveal token: 15 min single-session vs 5 min unlimited-uses? (Owner: E — start 15 min/single; tighten if abused.)
- Should `engineer` role see their own prompt text without reveal? (Owner: E + G — yes, `/me` is theirs, but still logged in `audit_events`.)

## Changelog

- 2026-04-16 — initial draft
