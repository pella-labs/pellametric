# Insights Revamp — Launch Checklist

Use this before flipping `PELLAMETRIC_INSIGHTS_REVAMP_UI=1` on a Pellametric
production deploy. Each row is a hard gate.

## Pre-flight

- [ ] `bash dev-docs/scripts/review.sh static` returns PASS on every check
      except "Working tree is clean" (which only matters in CI).
- [ ] `bun run typecheck && bun run test` are both green on the branch.
- [ ] `bun --filter='./apps/web' run build` succeeds with the same env vars
      production will see.
- [ ] Schema state is up to date — confirm via psql:
  ```sql
  SELECT column_name FROM information_schema.columns
   WHERE table_name='pr' AND column_name='previous_filenames';
  -- should return one row
  SELECT to_regclass('public.saved_insight') IS NOT NULL;
  -- should return t
  ```
- [ ] `model_pricing` table has rows for every active model. Verify:
  `SELECT count(*) FROM model_pricing` — should be ≥ 9.
- [ ] `PROMPT_MASTER_KEY` is set on production. (Without it, prompt ingest
      returns 500.)
- [ ] `INTERNAL_API_SECRET` is set; `_PREVIOUS` is empty unless mid-rotation.
- [ ] `LINEAGE_ALERT_WEBHOOK` is set if you want cohort-guard alerts to fire.

## Flag flip

- [ ] In Railway → web service → Variables, set
      `PELLAMETRIC_INSIGHTS_REVAMP_UI=1`. Railway will redeploy.
- [ ] Wait for the new image to be `Active`. Smoke-test:
  ```
  curl -sS https://pellametric.com/api/health/lineage -o /dev/null -w "%{http_code}\n"
  # expect 200 or 503 (503 = lineage worker behind; still healthy app)
  ```
- [ ] Manager: open `/org/github/<orgSlug>` — overview should show the new
      KPI strip + scatter (or the cold-start empty state if there's no data).
- [ ] Manager: open `/org/github/<orgSlug>/insights` — builder loads, defaults
      to `tokens_out × source × 30d`.
- [ ] Dev: open `/me/github/<orgSlug>` — Sankey hero renders (or empty state
      message about lineage).
- [ ] Dev: open a session detail — prompts are NOT pre-loaded; clicking
      "Decrypt prompts" calls `/api/me/sessions/.../prompts` which returns
      `Cache-Control: no-store`.

## Backfill

- [ ] For each App-installed org, manually trigger backfill (this is what the
      `installation.created` webhook does automatically for new installs):
  ```
  curl -sS -X POST -H "authorization: Bearer $INTERNAL_API_SECRET" \
    -H "content-type: application/json" \
    -d '{"orgId":"<UUID>","limit":25,"windowDays":30}' \
    https://pellametric.com/api/internal/lineage/backfill
  ```
- [ ] Re-run until response `status: "done"`. The progress banner on
      `/org/.../[slug]` will mirror this.

## Monitoring

- [ ] Lineage worker heartbeat:
      `curl -sS https://pellametric.com/api/health/lineage` returns 200 within
      a 5-minute polling window.
- [ ] Cohort-guard scan: configure an external scheduler (Railway cron,
      Vercel cron, etc.) to hit
      `POST /api/internal/cohort-guard` hourly with the internal secret.
- [ ] Confirm `LINEAGE_ALERT_WEBHOOK` payloads land in Slack / PagerDuty.

## Rollback

If anything regresses:

```
# Railway variable: PELLAMETRIC_INSIGHTS_REVAMP_UI=0  (redeploys, legacy UI returns)
```

For a schema-related regression:

```
psql "$DATABASE_URL" < /tmp/pellametric-pre-revamp-20260514T033518Z.sql
# (or the most recent snapshot from dev-docs/scripts/review.sh db)
```

The new tables (`saved_insight`, `saved_dashboard`, `dashboard_pinned_insight`)
are additive — rolling back the flag alone does not require touching them.
The `pr.previous_filenames` column is `NOT NULL DEFAULT '[]'::jsonb` so old
code paths are unaffected when the flag flips off.

## Post-launch tidy

- [ ] Delete legacy `apps/web/components/org-view-switcher.tsx`.
- [ ] Delete `apps/web/components/team-tables.tsx`.
- [ ] Add the `?view=me` 301 redirect to `next.config.ts`.
- [ ] Update CLAUDE.md's "Production" section to note the revamp is live.
- [ ] Squash + merge `feat/insights-revamp` → main.
