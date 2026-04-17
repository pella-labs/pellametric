# D2-03 Primer: Anomaly detector (hourly, per-dev rolling baseline + 3σ)

**Workstream:** H-AI · **Date:** 2026-04-17 · **Contract:** `dev-docs/PRD.md` §8.4 · **No D1 blockers**

## Goal

Hourly cron (NOT weekly — per §8.4 challenger call-out) that detects per-developer cost/token/tool-error spikes against a rolling 30-day baseline. Uses 3σ threshold with cohort fallback for new devs (<14 days of data). Writes to `alerts` PG table; emits SSE for Sandesh's dashboard.

## Deliverables

- [ ] `apps/worker/src/jobs/anomaly/detector.ts` — core algorithm: given a `DailyMetricRow[]` history and a "current hour" spike, compute mean/stddev and flag `|spike - mean| > 3σ`. Pure math; no IO.
- [ ] `apps/worker/src/jobs/anomaly/notifier.ts` — interface: `publish(Alert)` → PG insert + optional SSE push. Default `LoggingAnomalyNotifier` for tests.
- [ ] `apps/worker/src/jobs/anomaly/types.ts` — `DailyMetricRow`, `Alert`, `CohortP95`, `AnomalyNotifier`.
- [ ] `apps/worker/src/jobs/anomaly_detect.ts` — job entrypoint: reads `dev_daily_rollup` for last 30 days + current hour from raw `events`, applies detector, writes alerts.
- [ ] Hourly cron registration in `apps/worker/src/index.ts`.
- [ ] `__tests__/detector.test.ts` — 3σ trigger, cohort fallback, zero-stddev edge case.

## Signals tracked (v1)

| Signal | Source | Threshold |
|---|---|---|
| `cost_usd` | `dev_daily_rollup.cost_usd_state` | 3σ or cohort P95×5 |
| `input_tokens` | `dev_daily_rollup.input_tokens_state` | 3σ |
| `tool_error_rate` | `countIfState(tool_status='error')` / sessions | 3σ |

## Invariants

- **Hourly, not weekly.** Per CLAUDE.md: "Don't make managers wait a week for 'junior dev burned $400 on infinite loops'."
- Cohort fallback: when personal history < 14 active days, use cohort P95 × 5 as threshold. Cohort = org, same source (`claude-code`/`cursor`/etc).
- k-anonymity safety: never emit per-dev alerts for cohorts < 5.
- Reason tagged: `"sigma3" | "cohort_p95" | "zero_history_suppressed"`.

## Tests

- Seed synthetic 30 days of steady 10 evt/hour → spike of 500 evt/hour → alert fires.
- Zero-variance history (all same value) → cohort fallback kicks in.
- k < 5 cohort → no alert.
- Idempotency: same input twice → one alert row (dedup via `(engineer_id, signal, hour_bucket)`).

## Branch / PR

```bash
git switch -c D2-03-anomaly-detector-jorge
git push -u origin D2-03-anomaly-detector-jorge
gh pr create --base main --title "feat(worker): hourly anomaly detector (3σ + cohort fallback) (D2-03)"
```

## Time estimate

~4–5 h.

## After this ticket

- SSE channel wired by Workstream E on the dashboard side (per contract 07 §SSE channels).
- Sandesh's dashboard subscribes to `/sse/anomalies?team_id=…`.
