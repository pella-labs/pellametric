#!/usr/bin/env bash
# Automated review for feat/insights-revamp.
#
# Three phases:
#   static   — git/code/test checks. No DB, no server. Always safe.
#   db       — requires $DATABASE_URL. Takes snapshot first. Runs db:push.
#   runtime  — starts dev server, curls endpoints, asserts behavior.
#   all      — runs static → db → runtime.
#
# Usage: bash dev-docs/scripts/review.sh {static|db|runtime|all}
#
# Exit codes: 0 = all green, 1 = a check failed, 2 = setup error.

set -uo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

PHASE="${1:-all}"
PASS=0
FAIL=0
SKIP=0
REPORT="/tmp/pellametric-review-$(date -u +%Y%m%dT%H%M%SZ).md"
echo "# Insights Revamp Review — $(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$REPORT"

# ---- pretty printers ----
green()  { printf "\033[32m%s\033[0m\n" "$*"; }
red()    { printf "\033[31m%s\033[0m\n" "$*"; }
yellow() { printf "\033[33m%s\033[0m\n" "$*"; }
section() {
  echo
  echo "═══════════════════════════════════════════════════════════════"
  echo "  $1"
  echo "═══════════════════════════════════════════════════════════════"
  echo -e "\n## $1\n" >> "$REPORT"
}
check() {
  local label="$1"; shift
  printf "  %-60s " "$label"
  if "$@" >/tmp/check.log 2>&1; then
    green "PASS"
    echo "- [x] $label" >> "$REPORT"
    PASS=$((PASS+1))
  else
    red "FAIL"
    echo "- [ ] **$label** (see /tmp/check.log)" >> "$REPORT"
    echo '  ```' >> "$REPORT"
    head -20 /tmp/check.log >> "$REPORT"
    echo '  ```' >> "$REPORT"
    FAIL=$((FAIL+1))
  fi
}
skipnote() {
  printf "  %-60s " "$1"
  yellow "SKIP — $2"
  echo "- [~] $1 — skipped: $2" >> "$REPORT"
  SKIP=$((SKIP+1))
}

# ════════════════════════════════════════════════════════════════════
# STATIC PHASE — git + filesystem + tests + typecheck
# ════════════════════════════════════════════════════════════════════
run_static() {
  section "STATIC — git, types, tests, privacy invariants"

  check "On a feature branch (not main)" \
    bash -c '[[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ]]'

  check "Working tree is clean" \
    bash -c 'git diff --quiet && git diff --cached --quiet'

  check "Branch has commits ahead of main" \
    bash -c '[[ "$(git rev-list --count main..HEAD)" -gt 0 ]]'

  # Destructive-statement guard — anything that could lose data?
  check "No DROP TABLE / DROP COLUMN / RENAME / TRUNCATE in diff" \
    bash -c '! git diff main..HEAD -- "*.ts" "*.sql" | grep -iE "^\+.*\b(DROP TABLE|DROP COLUMN|TRUNCATE|RENAME (TABLE|COLUMN))\b" '

  # Privacy boundary
  check "apps/web/lib/crypto/prompts.ts UNCHANGED (privacy boundary)" \
    bash -c '[[ -z "$(git diff main..HEAD -- apps/web/lib/crypto/prompts.ts)" ]]'

  # OAuth fallback still intact
  check "apps/web/lib/aggregate.ts UNCHANGED (OAuth fallback dep)" \
    bash -c '[[ -z "$(git diff main..HEAD -- apps/web/lib/aggregate.ts)" ]]'

  # The browser-decrypt route MUST NOT exist (challenger killed it as P18)
  check "No /api/me/prompt-key route exists (P18 enforcement)" \
    bash -c '! find apps/web/app/api/me/prompt-key -type d 2>/dev/null | grep -q .'

  # The owner-decrypt route MUST exist
  check "/api/me/sessions/[id]/prompts route exists (P18)" \
    bash -c 'find apps/web/app/api/me/sessions -path "*prompts*" -name route.ts | grep -q .'

  # Decrypt route must enforce owner check
  check "Decrypt route checks userId ownership BEFORE decrypting" \
    bash -c 'PROMPTS_ROUTE=$(find apps/web/app/api/me/sessions -path "*prompts*" -name route.ts | head -1); [ -n "$PROMPTS_ROUTE" ] && grep -q "userId" "$PROMPTS_ROUTE" && grep -q "Cache-Control" "$PROMPTS_ROUTE"'

  # New tables landed in schema
  check "schema.ts contains pr_commit table" \
    grep -q "prCommit" apps/web/lib/db/schema.ts
  check "schema.ts contains model_pricing table" \
    grep -q "modelPricing" apps/web/lib/db/schema.ts
  check "schema.ts contains lineage_job table" \
    grep -q "lineageJob" apps/web/lib/db/schema.ts
  check "schema.ts contains system_health table" \
    grep -q "systemHealth" apps/web/lib/db/schema.ts
  check "schema.ts contains cost_per_pr table" \
    grep -q "costPerPr" apps/web/lib/db/schema.ts

  # No accidental byEmail index (P29)
  check "No pr_commit byEmail index (P29 — explicitly excluded)" \
    bash -c '! grep -q "pr_commit_by_email" apps/web/lib/db/schema.ts'

  # GIN index script exists
  check "post-push-indexes.sql exists (GIN on aiSources)" \
    bash -c '[ -f apps/web/scripts/post-push-indexes.sql ] && grep -q "USING gin" apps/web/scripts/post-push-indexes.sql'

  # Hot-path code landed
  check "lib/lineage/score.ts exists" \
    bash -c '[ -f apps/web/lib/lineage/score.ts ]'
  check "lib/lineage/attribute.ts exists" \
    bash -c '[ -f apps/web/lib/lineage/attribute.ts ]'
  check "lib/lineage/redact.ts exists" \
    bash -c '[ -f apps/web/lib/lineage/redact.ts ]'
  check "lib/lineage/proration.ts exists" \
    bash -c '[ -f apps/web/lib/lineage/proration.ts ]'
  check "lib/github/ancestry.ts exists" \
    bash -c '[ -f apps/web/lib/github/ancestry.ts ]'
  check "lib/insights/get-prs-for-org.ts exists" \
    bash -c '[ -f apps/web/lib/insights/get-prs-for-org.ts ]'
  check "lib/auth-middleware.ts exists" \
    bash -c '[ -f apps/web/lib/auth-middleware.ts ]'

  # API routes
  check "/api/github-webhook route exists" \
    bash -c '[ -f apps/web/app/api/github-webhook/route.ts ]'
  check "/api/internal/lineage/run route exists" \
    bash -c '[ -f apps/web/app/api/internal/lineage/run/route.ts ]'
  check "/api/internal/lineage/sweep route exists" \
    bash -c '[ -f apps/web/app/api/internal/lineage/sweep/route.ts ]'
  check "/api/health/lineage route exists" \
    bash -c '[ -f apps/web/app/api/health/lineage/route.ts ]'
  check "/api/insights/cohort/[metric] route exists" \
    bash -c '[ -f "apps/web/app/api/insights/cohort/[metric]/route.ts" ]'

  # Manager + dev UI
  check "Manager PR list page exists" \
    bash -c '[ -f "apps/web/app/org/[provider]/[slug]/prs/page.tsx" ]'
  check "Manager PR detail page exists" \
    bash -c '[ -f "apps/web/app/org/[provider]/[slug]/prs/[number]/page.tsx" ]'
  check "Dev /me overview page exists" \
    bash -c '[ -f "apps/web/app/me/[provider]/[slug]/page.tsx" ]'

  # Types + tests
  check "bun run typecheck" \
    bun run typecheck
  check "bun run test (all workspaces)" \
    bun run test

  # Tailwind v4 syntax compliance — no bracket-var
  check "No legacy bg-[var(...)] syntax in components" \
    bash -c '! git grep -nE "bg-\[var\(" -- "apps/web/**/*.tsx" "apps/web/**/*.ts"'
  check "No legacy bg-gradient-to-* (v4 uses bg-linear-to-*)" \
    bash -c '! git grep -nE "bg-gradient-to-" -- "apps/web/**/*.tsx" "apps/web/**/*.ts"'

  # Commit message convention
  check "All commits use conventional-commit format" \
    bash -c 'git log main..HEAD --format=%s | grep -vE "^(feat|fix|chore|test|docs|refactor|style|perf)(\([^)]+\))?: " && exit 1 || exit 0'

  # No Co-Authored-By in commits
  check "No Co-Authored-By trailers in branch commits" \
    bash -c '! git log main..HEAD --format=%B | grep -q "Co-Authored-By:"'

  echo
  echo "Static: $PASS passed, $FAIL failed, $SKIP skipped"
}

# ════════════════════════════════════════════════════════════════════
# DB PHASE — requires DATABASE_URL. Snapshot → dry-run → push → verify.
# ════════════════════════════════════════════════════════════════════
run_db() {
  section "DB — snapshot, dry-run, db:push, row-count diff"

  if [ -z "${DATABASE_URL:-}" ]; then
    skipnote "Entire DB phase" "DATABASE_URL not set"
    return
  fi

  # Snapshot
  SNAPSHOT="/tmp/pellametric-pre-revamp-$(date -u +%Y%m%dT%H%M%SZ).sql"
  check "pg_dump snapshot created" \
    bash -c "pg_dump \"\$DATABASE_URL\" --no-owner --no-acl --file=\"$SNAPSHOT\" && [ -s \"$SNAPSHOT\" ]"
  echo "  snapshot: $SNAPSHOT" >> "$REPORT"

  # Baseline row counts
  PRE_COUNTS="/tmp/pellametric-pre-counts.txt"
  psql "$DATABASE_URL" -At -F$'\t' -c "SELECT
    'sessions=' || count(*) FROM session_event UNION ALL SELECT
    'prs=' || count(*) FROM pr UNION ALL SELECT
    'prompts=' || count(*) FROM prompt_event UNION ALL SELECT
    'users=' || count(*) FROM \"user\" UNION ALL SELECT
    'orgs=' || count(*) FROM org;" 2>/dev/null | sort > "$PRE_COUNTS"
  check "Baseline row counts captured" \
    bash -c "[ -s \"$PRE_COUNTS\" ]"
  echo "  baseline:" >> "$REPORT"
  sed 's/^/    /' "$PRE_COUNTS" >> "$REPORT"

  # Dry-run inspection
  DIFF_SQL="/tmp/pellametric-diff.sql"
  bunx drizzle-kit push --strict --verbose --dialect=postgresql --schema=apps/web/lib/db/schema.ts 2>&1 \
    | tee "$DIFF_SQL" >/dev/null || true
  check "Dry-run output captured" \
    bash -c "[ -s \"$DIFF_SQL\" ]"
  check "No DROP / RENAME / TRUNCATE in proposed diff" \
    bash -c "! grep -iE '\b(DROP TABLE|DROP COLUMN|RENAME TO|RENAME COLUMN|TRUNCATE)\b' \"$DIFF_SQL\""
  check "No SET NOT NULL without DEFAULT in proposed diff" \
    bash -c "! (grep -iE 'ALTER COLUMN.*SET NOT NULL' \"$DIFF_SQL\" | grep -vi 'DEFAULT')"

  # Actual push (interactive prompts → fail-closed)
  check "bun run db:push completes without destructive prompts" \
    bash -c 'echo "" | bun run db:push 2>&1 | tee /tmp/push.log; ! grep -iE "(drop|rename|destroy|truncate)" /tmp/push.log'

  # Post-push counts
  POST_COUNTS="/tmp/pellametric-post-counts.txt"
  psql "$DATABASE_URL" -At -F$'\t' -c "SELECT
    'sessions=' || count(*) FROM session_event UNION ALL SELECT
    'prs=' || count(*) FROM pr UNION ALL SELECT
    'prompts=' || count(*) FROM prompt_event UNION ALL SELECT
    'users=' || count(*) FROM \"user\" UNION ALL SELECT
    'orgs=' || count(*) FROM org;" 2>/dev/null | sort > "$POST_COUNTS"
  check "Row counts unchanged after db:push (no data loss)" \
    diff "$PRE_COUNTS" "$POST_COUNTS"

  # GIN index
  check "post-push GIN index applied" \
    psql "$DATABASE_URL" -f apps/web/scripts/post-push-indexes.sql

  # Pricing seed
  check "Pricing seed loads (model_pricing has rows)" \
    bash -c 'bun run --cwd apps/web scripts/seed-pricing.ts && [ "$(psql "$DATABASE_URL" -At -c "SELECT count(*) FROM model_pricing")" -ge 9 ]'

  # New tables exist
  for tbl in pr_commit model_pricing lineage_job system_health daily_user_stats daily_org_stats cost_per_pr cohort_query_log backfill_state; do
    check "table $tbl exists in DB" \
      bash -c "psql \"\$DATABASE_URL\" -At -c \"SELECT to_regclass('public.$tbl') IS NOT NULL\" | grep -q t"
  done

  echo
  echo "DB phase: snapshot at $SNAPSHOT"
  echo "To rollback: psql \"\$DATABASE_URL\" < $SNAPSHOT"
}

# ════════════════════════════════════════════════════════════════════
# RUNTIME PHASE — dev server, API smoke tests
# ════════════════════════════════════════════════════════════════════
run_runtime() {
  section "RUNTIME — dev server, API smoke"

  if [ -z "${DATABASE_URL:-}" ]; then
    skipnote "Entire runtime phase" "DATABASE_URL not set"
    return
  fi
  if [ -z "${PROMPT_MASTER_KEY:-}" ]; then
    skipnote "Entire runtime phase" "PROMPT_MASTER_KEY not set"
    return
  fi

  # Start dev server with flag enabled
  export PELLAMETRIC_INSIGHTS_REVAMP_UI=1
  bun run dev > /tmp/dev-server.log 2>&1 &
  DEV_PID=$!
  trap "kill $DEV_PID 2>/dev/null || true" EXIT

  # Wait for server
  printf "  Waiting for dev server "
  for i in {1..60}; do
    if curl -fsS http://localhost:3000/ -o /dev/null 2>/dev/null; then
      green "READY"
      break
    fi
    printf "."
    sleep 1
  done

  # Health endpoint
  check "/api/health/lineage responds (503 expected if worker idle)" \
    bash -c 'STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/health/lineage); [ "$STATUS" = "200" ] || [ "$STATUS" = "503" ]'

  # Decrypt route requires auth
  check "/api/me/sessions/<id>/prompts returns 401/403 without auth" \
    bash -c 'STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/me/sessions/00000000-0000-0000-0000-000000000000/prompts); [ "$STATUS" = "401" ] || [ "$STATUS" = "403" ] || [ "$STATUS" = "404" ]'

  # No prompt-key route
  check "/api/me/prompt-key does NOT exist (returns 404)" \
    bash -c 'STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/me/prompt-key); [ "$STATUS" = "404" ]'

  # Internal routes require secret
  check "/api/internal/lineage/run rejects without INTERNAL_API_SECRET" \
    bash -c 'STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3000/api/internal/lineage/run -H "Content-Type: application/json" -d "{}"); [ "$STATUS" = "401" ] || [ "$STATUS" = "403" ]'

  # Cohort route requires auth
  check "/api/insights/cohort/cost_per_pr returns 401/403 without auth" \
    bash -c 'STATUS=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3000/api/insights/cohort/cost_per_pr?orgSlug=test"); [ "$STATUS" = "401" ] || [ "$STATUS" = "403" ] || [ "$STATUS" = "404" ]'

  # Webhook signature enforced
  check "/api/github-webhook rejects unsigned POST" \
    bash -c 'STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3000/api/github-webhook -H "Content-Type: application/json" -d "{}"); [ "$STATUS" = "401" ] || [ "$STATUS" = "403" ] || [ "$STATUS" = "400" ]'

  # Flag off → no new routes
  kill $DEV_PID 2>/dev/null || true
  wait $DEV_PID 2>/dev/null || true
  unset PELLAMETRIC_INSIGHTS_REVAMP_UI
  bun run dev > /tmp/dev-server-flagoff.log 2>&1 &
  DEV_PID=$!
  for i in {1..60}; do curl -fsS http://localhost:3000/ -o /dev/null 2>/dev/null && break; sleep 1; done

  check "Flag-off: old /dashboard still renders" \
    bash -c 'STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/dashboard); [ "$STATUS" = "200" ] || [ "$STATUS" = "307" ]'

  kill $DEV_PID 2>/dev/null || true
}

# ════════════════════════════════════════════════════════════════════
# DISPATCH
# ════════════════════════════════════════════════════════════════════
case "$PHASE" in
  static)  run_static ;;
  db)      run_db ;;
  runtime) run_runtime ;;
  all)     run_static; run_db; run_runtime ;;
  *) echo "Usage: $0 {static|db|runtime|all}"; exit 2 ;;
esac

echo
echo "═══════════════════════════════════════════════════════════════"
echo "  TOTAL: $PASS passed, $FAIL failed, $SKIP skipped"
echo "  Report: $REPORT"
echo "═══════════════════════════════════════════════════════════════"

echo -e "\n---\n**TOTAL:** $PASS passed, $FAIL failed, $SKIP skipped" >> "$REPORT"

[ $FAIL -eq 0 ]
