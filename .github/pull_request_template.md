<!--
Thanks for the PR. Please fill in every section; empty sections block review.
The canonical conventions doc is CLAUDE.md — read it first if you haven't.
-->

## Scope + why

<!-- 1-2 lines: what changes, and what product problem it solves. -->

## How it was tested

- [ ] `bun run lint`
- [ ] `bun run typecheck`
- [ ] `bun test`
- [ ] `bun --filter='@bematist/web' test:e2e` (if web-adjacent)
- [ ] `bun run test:privacy` (if privacy-adjacent — redaction, tier enforcement, k-anonymity, forbidden fields, cross-tenant RLS)
- [ ] `bun run test:scoring` (if scoring-adjacent — any change under `packages/scoring`; must keep MAE ≤ 3)
- [ ] `bun run test:perf` (if perf-adjacent — ingest hot path, dashboard queries, ClickHouse projections)

## Privacy invariants checked

See `CLAUDE.md` §"Privacy Model Rules" and §"Security Rules". For any change that touches API responses, telemetry, redaction, scoring display, or manager-facing views:

- [ ] No raw prompt text (`rawPrompt`, `prompt_text`, `messages`, `toolArgs`, `toolOutputs`, `fileContents`, `diffs`, `filePaths`, `ticketIds`, `emails`, `realNames`) added to any response or log line.
- [ ] k-anonymity floors respected — `k ≥ 5` for team tiles, `k ≥ 3` for prompt clusters, `k ≥ 25` for DP-noised releases.
- [ ] Any manager-facing read of IC-scoped data writes an `audit_log` / `audit_events` row (D30 transparency).
- [ ] Tier-C data paths guarded by `org.tier_c_managed_cloud_optin` (managed cloud) or explicit per-project IC opt-in (self-host).
- [ ] No per-IC leaderboards, bottom-10% lists, or performance scores introduced.

## Breaking change?

- [ ] Yes — migration note below.
- [ ] No.

<!-- If yes: describe the migration path, config/env changes, and whether existing fixtures / contracts / schema versions need bumping. -->

## Related PRD decision

<!-- If this PR implements or revises a locked decision D1–D32 in dev-docs/PRD.md, cite it (e.g. "D11 — AI Leverage Score v1"). Otherwise write "N/A". -->
