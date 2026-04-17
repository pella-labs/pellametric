# DevMetrics — Workstreams

> **This is a guide, not a lock.** The contracts referenced here are starting points so 5 people can build in parallel without colliding. Any owner can propose changes via PR — the goal is unblocking parallel work, not freezing the design. Iterate as we learn. If a contract turns out to be wrong, change it; just ping the consumers in the PR description.
>
> What IS locked: PRD decisions D1–D31 in `dev-docs/PRD.md` and the rules in `CLAUDE.md`. Workstreams and contracts must respect those; everything else is negotiable.

## Why workstreams

DevMetrics has too many moving parts (collector, ingest, dashboard, scoring, AI pipeline, privacy/redaction, storage, compliance) for 5 people to coordinate ad-hoc. Each workstream has one primary owner, a clear scope, and a small set of contracts they own at the seams with other workstreams. The owner is the decider for their workstream's internals; the contracts are how they communicate with the rest.

PRD §10 already groups the work as B–I. We keep those names so the PRD line numbers stay meaningful.

## Team mapping (5 devs)

Names assigned. Re-slice on Sprint 0 kickoff if the load isn't right; this is a starting point, not a contract.

- **Sebastian — Foundation + Web + Privacy UX (F + E + G-frontend).** Sprint 0 lead: repo, CI, Docker, Biome, branch protection. After Sprint 0 owns `apps/web` (Next.js 16 standalone), `packages/ui`, `packages/api` (manager half) — tRPC v11 routers, SSE channels, manager 2×2, `/me`, sessions, clusters, outcomes, insights digest, CSV export, brand tokens + shadcn/ui + Tremor + TanStack virtualized tables + Motion. Privacy UX: Bill of Rights page, Reveal modal + audit confirmation UI, `<REDACTED:type:hash>` chip renderer, IC daily digest UI, `cost_estimated`/`data_fidelity` chips. Also owns the Sprint-3 release pipeline (SLSA L3 reusable workflow, Sigstore + cosign signing, distro packaging for Homebrew/apt/AUR/Chocolatey), k6 perf gates, and observability defaults.
- **David — Collector & Adapters (B).** `apps/collector` (Bun-compile single binary) + Adapter SDK + the v1 adapter set (Claude Code full, Codex, Cursor, OpenCode, Continue.dev, +1 VS Code generic). On-device Clio pipeline plumbing. CLI commands. Egress journal.
- **Walid — Ingest & Server-Side Privacy (C + G-backend).** `apps/ingest` Bun server (OTLP, custom JSON, webhooks, Redis SETNX dedup, tier enforcement, rate limiting). GitHub App. Server-side `packages/redact` execution in the ingest hot path + forbidden-field fuzzer + Tier-A allowlist enforcement.
- **Jorge — Storage & AI Pipeline (D + H-AI).** `packages/schema` (ClickHouse + Postgres + Drizzle), partition-drop GDPR worker, Plan B Go side-car. Then `packages/embed` provider chain, Twin Finder, nightly cluster job, Insight Engine 6-call pipeline, anomaly detector.
- **Sandesh — Scoring & Compliance (H-scoring + I).** `packages/scoring` — `ai_leverage_v1` locked math, useful_output_v1, subscores, cohort percentile-rank, confidence, metric versioning. 500-case synthetic dev-month eval (MAE ≤ 3 merge blocker) + held-out 100-case validation split. Compliance templates (works-council DE/FR/IT, DPIA, SCCs 2021/914 Module 2, Bill of Rights wording, CAIQ v4.0.3 + SIG Lite 2024 vendor docs, CycloneDX SBOM, audit-events row schema).

### Why this split

- **Sebastian gets foundation + web + privacy UX.** Foundation is front-loaded (heavy Sprint 0); release/SLSA/distro is the natural Sprint-3 continuation. Between those, Sebastian owns the full dashboard surface (`apps/web`) + privacy UX (Reveal flow, audit digest, Bill of Rights) — the dashboard and privacy UX pair naturally (same components, same Reveal gesture, same chip renderer). Re-sliced from the initial draft (2026-04-16) where this was Sandesh's scope — too much combined load.
- **David gets all of B** because the collector is the biggest single deliverable and per-adapter work parallelizes cleanly inside one owner.
- **Walid gets ingest + the server-side half of privacy** because the redaction execution lives in the ingest hot path — same code, same ops surface, same perf budget. Cleaner than splitting across two devs.
- **Jorge gets storage + the AI pipeline** because both are server-side, infra-flavored work (DB schema + ML ops). The embed/Insight Engine reads the storage schema heavily; one owner removes a coordination seam.
- **Sandesh gets scoring + compliance.** Scoring is small-but-eval-gated math (MAE ≤ 3 merge blocker) where quality matters more than volume; compliance is doc-heavy (works-council templates, DPIA, SCCs, vendor questionnaires). Both land well away from the frontend surface so Sandesh owns a clean vertical. If scoring evals slip, Sebastian is the documented floater.

## Workstream table

| WS | Name | Primary owner | Scope | Primary packages | Contracts owned | Contracts consumed |
|---|---|---|---|---|---|---|
| **B** | Collector & Adapters | David | `bun build --compile` per-machine binary; v1 adapters (Claude Code full, Cursor token-only, Codex, OpenCode post-migration, Continue.dev full, +1 VS Code generic); Phase-2 adapters; on-device Clio pipeline plumbing; egress journal; CLI commands. | `apps/collector`, `packages/sdk`, `packages/clio` (on-device half), `packages/redact` (collector-side defense-in-depth), `packages/fixtures` | `03-adapter-sdk`, co-owns `01-event-wire`, `06-clio-pipeline` | `02-ingest-api`, `08-redaction` |
| **C** | Ingest & Webhooks | Walid | Bun ingest server (OTLP HTTP/Protobuf + custom JSON + webhooks); Redis SETNX dedup; tier enforcement; rate limiting; GitHub App. | `apps/ingest`, `packages/api` (ingest half) | `02-ingest-api`, co-owns `01-event-wire` | `03-adapter-sdk`, `08-redaction`, `09-storage-schema` |
| **D** | Storage & Schema | Jorge | ClickHouse `events` table + projections + materialized views; Postgres control plane + RLS + Drizzle migrations; partition-drop GDPR worker (7-d SLA); Plan B Go side-car (if F15 soak fails). | `packages/schema`, `apps/worker` | `09-storage-schema` | `01-event-wire` |
| **E** | Web & Manager API | Sebastian | Next.js 16 dashboard; tRPC v11 routers; SSE realtime; manager 2×2; IC `/me` views; Reveal gesture + audit confirm; CSV export rules; brand tokens + UI kit. | `apps/web`, `packages/ui`, `packages/api` (manager half) | `07-manager-api` | `04-scoring-io`, `09-storage-schema`, `08-redaction` |
| **F** | Foundation & Infra | Sebastian | Repo bootstrap, Bun workspaces, Biome, CI/CD (GH Actions), SLSA L3 reusable workflow, Sigstore signing, distro packaging, Docker Compose, k6 perf gates, observability defaults. | repo root, `.github/workflows/`, `Dockerfile`, `docker-compose*.yml` | (no inter-workstream contracts; sets up the platform everyone else uses) | all |
| **G-backend** | Privacy execution | Walid | Server-side TruffleHog + Gitleaks + Presidio in ingest hot path; forbidden-field fuzzer; Tier-A allowlist enforcement; Ed25519 signed-config validator. | `packages/redact` (server side), `redaction_audit` table writes | `08-redaction`, co-owns `06-clio-pipeline` (server verifier) | `01-event-wire`, `09-storage-schema` |
| **G-frontend** | Privacy UX | Sebastian | Bill of Rights page (`/privacy`); Reveal modal + audit confirm UX; `<REDACTED:type:hash>` chip renderer; IC daily digest UI; `cost_estimated` and `data_fidelity` indicator chips. | `apps/web/privacy`, `apps/web/me/digest`, UI components | (consumes `08-redaction` marker format) | `08-redaction`, `07-manager-api` |
| **H-scoring** | Scoring math | Sandesh | `ai_leverage_v1` math; useful_output_v1; subscores; cohort percentile-rank; confidence; 500-case eval; metric versioning. | `packages/scoring` | `04-scoring-io` | `09-storage-schema` (reads MVs) |
| **H-AI** | AI pipeline | Jorge | Embed provider abstraction (OpenAI/Voyage/Ollama/Xenova); embedding cache; Twin Finder live API; nightly cluster recompute (Batch API); Insight Engine 6-call pipeline (H4a–H4f); cluster labeler; anomaly detector (hourly, 3σ). | `packages/embed`, `packages/clio` (server verifier + embed stage) | `05-embed-provider` | `09-storage-schema`, `06-clio-pipeline` |
| **I** | Compliance & Legal | Sandesh | Works-council templates (DE/FR/IT); DPIA; SCCs 2021/914 Module 2; Bill of Rights wording; vendor-assessment artifacts (CAIQ v4.0.3, SIG Lite 2024); SOC 2 prep; SBOM (CycloneDX); audit-events row schema. | `legal/templates/`, `dev-docs/compliance/` | (mostly docs; reviews privacy contracts) | `08-redaction`, `07-manager-api` |

## Critical path — what must land first

Sprint 0 is the only week where the team can't fully fan out. The list below is the **Sprint-0 unblock set** — small, mostly Sebastian-led, but pulls in seeds from David / Walid / Jorge so per-workstream work can start in parallel by end of week 1. Sandesh uses Sprint 0 to read PRD + contracts and draft I (compliance) templates as non-blocking parallel work, then starts H-scoring on Day 5+.

### Day 1–2 — Sebastian solo (others read PRD + contracts in parallel)

1. **F0a — Repo skeleton.** `apps/{web,ingest,collector,worker}/` + `packages/{schema,otel,sdk,api,ui,redact,embed,scoring,clio,fixtures,config}/` + workspace `package.json` + Bun setup. **Blocks: everything.**
2. **F0b — Lint/format/typecheck baseline.** Biome config, tsconfig base, `.editorconfig`, `.gitignore`, `.env.example` with every var documented. **Blocks: PR CI.**
3. **F0c — Docker Compose dev.** Postgres 16 + ClickHouse 25 + Redis 7 + optional `otel-collector` profile. `docker compose -f docker-compose.dev.yml up` brings up the stack. **Blocks: any local dev for C/D/E/H.**
4. **F0d — CI base workflow.** Lint, typecheck, unit test on every PR. Branch protection enforced. **Blocks: any merge.**

### Day 2–3 — three "seed" PRs in parallel (each owner ships a stub of their seam)

These three seeds are what unblock everyone else. Each is intentionally small; perfection comes later.

5. **D-seed (Jorge) — Event schema + first migrations.** `packages/schema/event.ts` zod matching `01-event-wire.md`; ClickHouse `events` table DDL stub matching `09-storage-schema.md`; first PG migration with `orgs`, `users`, `developers`. **Unblocks: B (knows what to emit), C (knows what to validate), D (canonical shape pinned), E (knows what to query), H (knows what to score).**
6. **B-seed (David) — Adapter SDK interface + first adapter scaffold.** `packages/sdk/adapter.ts` matching `03-adapter-sdk.md`; Claude Code adapter scaffold (file structure + golden fixture in `packages/fixtures/claude-code/`). **Unblocks: per-adapter parallel work inside B; David can recruit Phase-2 adapter help if needed.**
7. **C-seed (Walid) — Ingest skeleton.** `apps/ingest` Bun server with `/healthz`, `/readyz`, `/v1/events` zod-validating against the event schema, console-only sink (no DB write yet). **Unblocks: B's first end-to-end smoke test; E's mock-data fallback can be replaced with real ingest.**

### Day 3–5 — full parallel fan-out

By end of Sprint 0 (M0 below), every workstream has an owner with a working dev environment, the contracts they need to read are in `contracts/`, and the seeds above are merged. Re-slice if anyone is blocked.

## Merge checkpoints

Four checkpoints, one per sprint. Each checkpoint is a **short integration window** (½ day) where everyone's branches merge to `main` and we run the full test/perf/privacy gates together. Between checkpoints, work happens on feature branches with green CI; at the checkpoint, we run end-to-end.

### M0 — Sprint 0 end (~Day 5) — "stack boots, contracts seeded"

- ✅ `bun install && bun run dev` brings up the full stack locally
- ✅ Docker Compose dev runs Postgres + ClickHouse + Redis
- ✅ CI green on lint + typecheck + unit
- ✅ D-seed, B-seed, C-seed merged
- ✅ Every dev has pushed at least one PR (proves access + workflow)

**Owner of the merge window:** Sebastian.

### M1 — Sprint 1 end (~Day 12) — "first event end-to-end"

- ✅ David's Claude Code adapter emits a real event
- ✅ Walid's ingest validates, dedups (Redis SETNX), writes to CH
- ✅ Jorge's CH `events` table receives it; first MV (`dev_daily_rollup`) populates
- ✅ Sebastian's dashboard renders one tile from real data (cost over 7d)
- ✅ Sandesh's scoring v0 stub returns a number for that one engineer
- ✅ Bill of Rights page renders (Sebastian)
- ✅ Privacy fuzzer skeleton runs in CI (Walid)
- ✅ Sandesh's I-template drafts (DE/FR/IT works-council, DPIA outline) merged as drafts

**Gate:** "first event" smoke test passes end-to-end. Anyone fails → fix before tagging M1.

### M2 — Sprint 2 end (~Day 19) — "feature-complete MVP"

- ✅ All 6 v1 adapters working with golden fixtures (David)
- ✅ OTLP receiver + webhooks + GitHub App live (Walid)
- ✅ All MVs + projections + RLS + partition-drop worker (Jorge)
- ✅ Manager 2×2 + `/me` + Reveal flow + cluster pages + outcomes (Sebastian)
- ✅ Scoring math passes 500-case eval (MAE ≤ 3, no outlier > 10) — **MERGE BLOCKER** (Sandesh)
- ✅ Insight Engine H4a–H4f pipeline returns High-confidence insights (Jorge)
- ✅ Embed provider chain + nightly cluster job (Jorge)
- ✅ Anomaly SSE channel emits hourly (Jorge → Sebastian)
- ✅ Privacy adversarial gate green: ≥98% secret recall, 100% forbidden-field rejection, ≥95% Clio verifier recall — **MERGE BLOCKER** (Walid + Sebastian consuming markers)
- ✅ Perf gate: p95 dashboard <2s with 1M seeded events, p99 ingest <100ms — **MERGE BLOCKER** (Sebastian sets up k6 + tunes web, Jorge tunes CH, Walid tunes ingest)

**Gate:** all three MERGE BLOCKERs pass. The 24h Bun↔ClickHouse soak (F15 / INT0) starts at the M2 tag — Plan B Go side-car ready in `apps/ingest-sidecar/` if soak fails (Jorge).

### M3 — Sprint 3 end (~Day 26) — "PoC ship"

- ✅ Polish, bug bash, doc strings, PoC demo recorded
- ✅ SLSA L3 release pipeline + Sigstore + cosign signed binaries
- ✅ Distro packages built: Homebrew, apt/deb, AUR, Chocolatey
- ✅ `curl | sh` fallback wrapped in function (partial-pipe-safe)
- ✅ Compliance docs final: DE/FR/IT works-council templates, DPIA, SCCs, Bill of Rights, CAIQ v4.0.3 + SIG Lite 2024 pre-fills (Sandesh)
- ✅ GDPR erasure E2E (INT12) verified
- ✅ Phase 0 P0 fixes complete (D17 — `parseSessionFile`, `durationMs`, `firstTryRate`, safe file reader, pricing freshness, onboarding safety)

**Gate:** can a customer install, capture events from 3 IDEs, and view a dashboard within 15 minutes? If yes → ship.

## Dependency graph

```
                    ┌──────────────────────────────────────────────────┐
                    │  Sprint 0 — Sebastian leads, others read         │
                    └──────────────────────────────────────────────────┘
                                       │
                F0a Repo skeleton ─────┤
                F0b Lint/typecheck ────┤
                F0c Docker Compose ────┤
                F0d CI base ───────────┘
                                       │
                                       ▼
              ┌───────────────────────┴──────────────────────┐
              │   3 seeds in parallel (Day 2–3)              │
              ├──────────────────────────────────────────────┤
              │   D-seed (Jorge):   event schema + DDL     │
              │   B-seed (David):     adapter SDK iface      │
              │   C-seed (Walid):     ingest skeleton        │
              └───────────────────────┬──────────────────────┘
                                       │
                                       ▼
                              ━━━━━━━ M0 ━━━━━━━
                                       │
        ┌─────────────┬─────────────┬──┴──────────┬─────────────────────┬──────────────┐
        ▼             ▼             ▼             ▼                     ▼              │
    David (B)     Walid (C)     Jorge (D)   Sandesh (H-sc+I)  Sebastian (F+E+G-front) │
    Claude        /v1/events    events tbl    scoring v0         Next.js shell          │
    Code adptr    + zod redact  + 1st MV      stub               + 1st tile             │
                                              + I template       + Bill of Rights       │
                                              drafts             + observability        │
                                                                 + perf scaffold        │
        │             │             │             │                     │              │
        └─────────────┴──────┬──────┴─────────────┴─────────────────────┘              │
                             │                                                          │
                             ▼                                                          │
                      ━━━━━━━ M1 ━━━━━━━ first event E2E                               │
                             │                                                          │
        ┌─────────────┬──────┴──────┬─────────────┬─────────────────────┬──────────────┐
        ▼             ▼             ▼             ▼                     ▼              │
    David         Walid         Jorge        Sandesh               Sebastian           │
    adapters 2-6  OTLP+webhk    MVs+RLS+      scoring math          E: 2×2 + /me       │
    + Clio        + GH App      partn drop   (H-sc) + 500-case      + reveal + clusters│
    plumbing      G-back: fuzz  +H-AI:        eval + I templates    G-front: BoR +     │
                  + allowlist   embed/Twin                          reveal UX + chips  │
                                /cluster                            F-cont: k6 +       │
                                /Insight                            soak + observab.   │
                                /anomaly                                               │
        └─────────────┴─────────────┴──────┬──┴─────────────────────┘                  │
                                            │                                      │
                                            ▼                                      │
                                  ━━━━━━━ M2 ━━━━━━━ feature-complete             │
                                  ─ MERGE BLOCKER: 500-case eval                  │
                                  ─ MERGE BLOCKER: privacy adversarial            │
                                  ─ MERGE BLOCKER: perf gates                     │
                                  ─ 24h soak STARTS                               │
                                            │                                      │
                                            ▼                                      │
                                       polish + ship  ◀────────────────────────────┘
                                            │
                                            ▼
                                  ━━━━━━━ M3 ━━━━━━━ PoC ship
                                  SLSA L3 + signed releases
                                  Compliance templates final
                                  GDPR erasure E2E verified
```

### Cross-workstream dependencies (read this if you're blocked)

| Blocked party | Blocked by | Contract that mediates |
|---|---|---|
| David (B) needs to know what to emit | Jorge (D-seed) | `01-event-wire.md` |
| Walid (C) needs to know what to validate | Jorge (D-seed) | `01-event-wire.md` |
| Sebastian (E) needs to know what to query | Jorge (D — MVs) | `09-storage-schema.md`, `04-scoring-io.md` |
| Sandesh (H-sc) needs aggregated inputs | Jorge (D — MVs) | `09-storage-schema.md` (`dev_daily_rollup`, `team_weekly_rollup`) |
| Jorge (H-AI) needs prompt embeddings to land | David (B — Clio pipeline) | `06-clio-pipeline.md` |
| Walid (G-back) needs the redact contract | Sebastian (G-front consumes same markers) | `08-redaction.md` |
| Sebastian (E) reveal flow | Walid (C) writes audit_log | `07-manager-api.md` + `09-storage-schema.md` |
| Sandesh (I) compliance docs reference | Walid (G-back), Jorge (D — retention) | all of `06`, `07`, `08`, `09` |
| Sebastian (E) needs scoring outputs | Sandesh (H-sc) | `04-scoring-io.md` |

If you're blocked and the table doesn't list it: ping the contract owner in chat AND open a draft PR against the relevant `contracts/NN-*.md` file. Don't wait silently.

## How to add or change a contract

1. Open a PR that edits the relevant `contracts/NN-*.md` file. If it's a new seam, add a new file with the next number.
2. **Additive change** (new optional field, new endpoint, new enum value with default) — merge after one reviewer from a consuming workstream signs off.
3. **Breaking change** (rename, removed field, semantic shift) — list all consumers in the PR description, get approval from each, bump the contract's Changelog with a date and one-line reason. If the consumer can't migrate in the same PR, ship the new field alongside the old, then remove the old in a follow-up.
4. Append a Changelog line in the contract file. Future-you and new joiners will read it before reading the body.
5. **Don't wait for perfect agreement.** A contract that's 80% right and shipped today is worth more than a contract that's 100% right and shipped in two weeks. Mark uncertainties in the contract's "Open questions" section and keep moving.

## Out-of-scope reminder

Things to actively reject in PRs (from CLAUDE.md / PRD §2.3):

- Anything Pharos-shaped (IPC, Electron, `pharos-ade.com` upload). DevMetrics is independent (D1).
- Per-engineer leaderboards, performance scores, real-time per-IC feeds, autonomous coaching.
- IDE plugin surfaces (we observe agents, not editors).
- Cross-tenant benchmarking.
- Tier C as default. Default is Tier B (D7).

## References

- `CLAUDE.md` — project conventions, locked rules
- `dev-docs/PRD.md` — full PRD with D1–D31
- `dev-docs/summary.md` — conflict-resolution matrix
- `contracts/` — the seams between workstreams (this directory is what unblocks parallel work)
