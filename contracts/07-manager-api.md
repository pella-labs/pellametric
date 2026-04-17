# 07 — Manager API (Server Actions + Route Handlers + SSE)

**Status:** draft
**Owners:** Workstream E (web/dashboard), Workstream C (ingest hosts the event surface; manager API is co-located in `apps/web`)
**Consumers:** `apps/web` (Next.js dashboard), CLI (`bematist outcomes`, `bematist waste`, `bematist prompts`)
**Last touched:** 2026-04-16

## Purpose

The HTTP/SSE surface the dashboard (and the CLI's read-side commands) call. Built on **Next.js 16 primitives — no tRPC**:

- **RSC pages** import server-side data-access functions from `packages/api` directly. Most read traffic never crosses an HTTP boundary inside the app.
- **Server Actions** (`"use server"`) for mutations (reveal, policy writes, notification prefs). Client components invoke via `useFormState` / `useTransition`.
- **Route Handlers** under `apps/web/app/api/**/route.ts` for (a) client-fetched reads that don't sit inside an RSC tree, (b) SSE streams, (c) CSV export, (d) the CLI's read surface.

**Typing:** TypeScript inference on exported server function / Server Action signatures flows end-to-end into the RSC tree and into client components that call actions. No codegen, no router registry. The zod schemas in `packages/api/src/schemas/` are the source of truth for inputs and outputs — shared verbatim by Server Actions, Route Handlers, and the CLI.

Read-only at v0 for analytics — there is no write path that affects analytics from the dashboard. Configuration writes (policy, alerts, ingest keys) go through admin Server Actions (out of scope here; lives in the BSL admin module).

## Surface map

```
packages/api/src/queries/*       — server-only data-access functions (RSC-callable)
packages/api/src/mutations/*     — server-only mutation functions (wrapped by Server Actions)
packages/api/src/schemas/*       — zod schemas (inputs + outputs) shared everywhere

apps/web/lib/actions/*.ts        — "use server" files wrapping mutations
apps/web/app/api/**/route.ts     — Route Handlers for client-fetched reads, SSE, CSV
apps/web/app/sse/**/route.ts     — SSE channels
```

The dashboard surface (by feature area):

```
dashboard      // top-level summary widgets
team           // /team/<slug> pages
engineer       // /me + /engineer/<id> (limited by RBAC)
session        // /sessions/<id>
cluster        // prompt clusters and Twin Finder
outcomes       // PR / commit / test outcomes
alerts         // anomaly alerts feed
insights       // weekly insight engine output
audit          // who-viewed-whom log (Bill of Rights #6)
policy         // read-only — policy diff for current user/org
```

Each area has a matching file in `packages/api/src/queries/<area>.ts` and, where mutations exist, `packages/api/src/mutations/<area>.ts`.

## Sample shapes

### Data-access function (server-only)

```ts
// packages/api/src/queries/dashboard.ts
import "server-only";
import { z } from "zod";
import type { Ctx } from "../auth";
import { DashboardSummaryInput, DashboardSummaryOutput } from "../schemas/dashboard";
import { assertRole } from "../auth";
import { applyDisplayGate } from "../gates";

export async function getSummary(
  ctx: Ctx,
  input: z.infer<typeof DashboardSummaryInput>,
): Promise<z.infer<typeof DashboardSummaryOutput>> {
  assertRole(ctx, ["admin", "manager", "viewer"]);
  // SELECT from dev_daily_rollup / team_weekly_rollup, scoped by ctx.tenant_id
  // tiles that fail display gates (04-scoring-io.md) get { show: false } via applyDisplayGate
  // ...
}
```

### Zod schema (shared source of truth)

```ts
// packages/api/src/schemas/dashboard.ts
import { z } from "zod";

export const DashboardSummaryInput = z.object({
  window: z.enum(["7d", "30d", "90d"]),
  team_id: z.string().optional(),
});

export const DashboardSummaryOutput = z.object({
  ai_leverage_score: DisplayGated(z.number().min(0).max(100)),
  total_cost_usd: z.number().nonnegative(),
  accepted_edits: z.number().nonnegative(),
  sessions: z.number().nonnegative(),
  // ...
});
```

### RSC page (reads direct via import)

```tsx
// apps/web/app/(dashboard)/page.tsx
import { getSessionCtx } from "@/lib/session";
import { getSummary } from "@bematist/api/queries/dashboard";

export default async function DashboardPage() {
  const ctx = await getSessionCtx();
  const summary = await getSummary(ctx, { window: "7d" });
  return <DashboardTiles data={summary} />;
}
```

### Server Action (mutation)

```ts
// apps/web/lib/actions/session.ts
"use server";
import { zodAction } from "@/lib/zodActions";
import { RevealInput, RevealOutput } from "@bematist/api/schemas/session";
import { revealSession } from "@bematist/api/mutations/session";

export const revealSessionAction = zodAction(
  RevealInput,
  RevealOutput,
  revealSession,
);
```

`zodAction` is a tiny wrapper: resolves the session ctx, runs zod input validation, invokes the mutation, and returns a discriminated-result `{ ok: true, data } | { ok: false, error: { code, message } }`. No framework needed.

### Route Handler (client-fetched read or CLI surface)

```ts
// apps/web/app/api/dashboard/summary/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSessionCtx } from "@/lib/session";
import { DashboardSummaryInput } from "@bematist/api/schemas/dashboard";
import { getSummary } from "@bematist/api/queries/dashboard";

export async function GET(req: NextRequest) {
  const ctx = await getSessionCtx(req);
  const parsed = DashboardSummaryInput.safeParse({
    window: req.nextUrl.searchParams.get("window"),
    team_id: req.nextUrl.searchParams.get("team_id") ?? undefined,
  });
  if (!parsed.success) return NextResponse.json({ error: "bad_request", issues: parsed.error.issues }, { status: 400 });
  const data = await getSummary(ctx, parsed.data);
  return NextResponse.json(data);
}
```

Most read endpoints live server-side inside RSC and skip the Route Handler. We only add a Route Handler when:
1. a client component needs the data,
2. the CLI needs the data, or
3. the response is a stream (SSE) or file (CSV).

### Mutation (server-only)

```ts
// packages/api/src/mutations/session.ts
import "server-only";
import { z } from "zod";
import type { Ctx } from "../auth";
import { RevealInput, RevealOutput } from "../schemas/session";

export async function revealSession(
  ctx: Ctx,
  input: z.infer<typeof RevealInput>,
): Promise<z.infer<typeof RevealOutput>> {
  // Step 1: check IC opt-in OR admin signed-config tier-C OR auditor role
  // Step 2: write audit_log entry { actor, target_engineer, session_id, reason, ts }
  // Step 3: write audit_events row (D30) — IC's daily digest surfaces this
  // Step 4: issue short-lived reveal token (15 min, single-use) into Redis
  // returns { reveal_token }
}
```

## SSE channels

For realtime tiles. Bun-native SSE (no socket.io; CLAUDE.md pins native Bun + SSE). Mounted as Next.js Route Handlers so they share the same session resolution path.

| Path | Event payloads | Notes |
|---|---|---|
| `GET /sse/anomalies?team_id=…` | `{ kind: "anomaly", dev_id_hash, signal, value, threshold, ts }` | Hourly anomaly detector pushes here. NEVER per-session real-time (would breach D2 panopticon non-goal). |
| `GET /sse/cost?org_id=…` | `{ kind: "cost_tick", cost_usd_30s, ts }` | Aggregated 30-second buckets, org-level. |
| `GET /sse/collector_health?org_id=…` | `{ kind: "collector", device_id, status, fidelity, version, last_event_at }` | Powers the dashboard's collector-health widget. |

Each SSE handler returns a `new Response(stream, { headers: { "content-type": "text/event-stream" } })` using a native `ReadableStream`. Heartbeat every 15s.

**Banned channels** (ever) — these would require event types we refuse to ship:
- per-engineer event stream
- per-session token-tick
- "live coding feed"

A plain-text CI step greps `apps/web/app/sse/` for forbidden channel names and fails the build on match.

## Authn / Authz

- **Authn:** Better Auth (1.5+). Session cookie for the dashboard; bearer token for the CLI (validated by the same session helper).
- **Authz:** RBAC roles defined in `packages/api/src/auth.ts`:
  - `admin` — full access; can flip tier-C with signed config + cooldown
  - `manager` — team-scoped reads; 2×2 view; CANNOT read IC prompt text without reveal mutation
  - `engineer` — `/me` + own sessions; can opt-in tier-C per project
  - `auditor` — legal-hold reveal; logged
  - `viewer` — read-only summary tiles, no individual data
- `assertRole(ctx, allowed)` runs at the top of every query and mutation — not at the Route Handler or Server Action level. Defense in depth: even if a Route Handler wrapper forgets, the query refuses.
- **Cross-tenant probe (INT9)** — adversarial test attempts cross-tenant query with each role's token. MUST return 0 rows. Merge blocker.

## Reveal gesture (D8)

Reading IC prompt text requires:
1. **Server Action `revealSessionAction`** invoked with a non-empty reason.
2. **Server-side check** of one of three conditions:
   - IC opted in to project-scope tier C; OR
   - Admin flipped tenant-wide signed config + 7d cooldown elapsed + IC banner shown; OR
   - Auditor role + legal-hold flag set.
3. **Audit row** `audit_log` (immutable) AND `audit_events` row (per-manager-view, D30).
4. **Reveal token** valid 15 min, single-session, stored in Redis with a single-use flag.

Without the token, `queries.session.getSession` returns `prompt_text: null` with `redacted_reason: "consent_required"`.

## CSV export rules

Lives at `apps/web/app/api/export/route.ts`.

- Default export: `prompt_text` and `tool_input/tool_output` columns omitted.
- `?include_prompts=true` requires:
  - 2FA challenge passed in the last 5 min.
  - `audit_log` entry written.
  - Per-row reveal-eligibility check (server enforces; client request is not the boundary).
- Streaming via `csv-stringify` piped into a `Response` body.

## Error model

Discriminated result from Server Actions + standard HTTP semantics from Route Handlers.

**Server Action return:**

```ts
type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: ErrorCode; message: string; issues?: z.ZodIssue[] } };
```

**Error codes (used by both Server Actions and Route Handlers — Route Handlers also set HTTP status):**

| Code | HTTP | Meaning |
|---|---|---|
| `UNAUTHORIZED` | 401 | No session |
| `FORBIDDEN` | 403 | RBAC fail or tier-C without opt-in |
| `NOT_FOUND` | 404 | scope_id doesn't exist or RLS blocked |
| `BAD_REQUEST` | 400 | zod validation failed |
| `TOO_MANY_REQUESTS` | 429 | Redis token bucket exhausted |
| `INTERNAL_SERVER_ERROR` | 500 | log + Sentry breadcrumb |

Client components switch on `error.code` to render the right UI.

## Performance gates

- p95 dashboard latency **<2s** with 1M seeded events (PRD §10). Measured end-to-end (RSC render included).
- Read paths use ClickHouse materialized views, not raw `events`. `EXPLAIN` checked for projection use.
- Server Actions are marked `"use server"`; Next.js serializes arg / return over the wire using its built-in format — no extra transport layer.

## Invariants

1. **Read-only at the action layer.** Mutations exist only for reveal/opt-in/policy — never for analytics writes.
2. **RBAC enforced server-side at the query/mutation layer.** Frontend role checks are UX, not security. Server Actions and Route Handlers are thin wrappers; the authoritative checks live in `packages/api`.
3. **Reveal gesture is the ONLY path to prompt_text.** Direct queries that return prompt text without a valid reveal token fail.
4. **Display gates (`04-scoring-io.md`) honored at the API layer.** If `display.show=false`, the query returns the suppression reason; frontend renders "insufficient data — gate X". The server doesn't ship a number that the gate said shouldn't ship.
5. **Insight confidence filtering server-side** — Low-confidence insights are dropped before the response leaves the server. Frontend never sees them.
6. **No SSE channel that would constitute a "real-time per-engineer event feed"** (panopticon non-goal).
7. **Zod schemas are the shared source of truth.** Server Actions, Route Handlers, RSC pages, and the CLI all import from `packages/api/src/schemas/`. Changes ripple via TS errors, not hand-kept parity.

## Open questions

- Do we expose a stable REST API (OpenAPI) for non-TS tooling? (Owner: E + C — the Route Handlers already ARE a REST surface; we can emit an OpenAPI doc from the zod schemas via `zod-to-openapi` if a consumer asks. Not v0.)
- Reveal token: 15 min single-session vs 5 min unlimited-uses? (Owner: E — start 15 min/single; tighten if abused.)
- Should `engineer` role see their own prompt text without reveal? (Owner: E + G — yes, `/me` is theirs, but still logged in `audit_events`.)
- Do we want a typed client for the CLI to consume Route Handlers, or is hand-rolled `fetch + zod.parse` enough? (Owner: E — start hand-rolled; consider a tiny `packages/api-client` generator if we add more than ~5 CLI commands.)

## Changelog

- 2026-04-16 — initial draft (tRPC baseline)
- 2026-04-16 — rewrite: swap tRPC for Next.js Server Actions + Route Handlers + direct RSC imports. RBAC, reveal gesture, SSE channels, CSV rules, display-gate invariants unchanged. Zod schemas become the cross-surface source of truth.
