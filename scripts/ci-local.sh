#!/usr/bin/env bash
# Run the CI "build" job locally against the docker-compose.dev.yml stack.
# Mirrors .github/workflows/ci.yml — lint, typecheck, migrations, tests (with
# PG_INTEGRATION_TESTS=1 so integration tests that would silently skip on a
# fresh checkout actually execute).
#
# Service ports default to docker-compose.dev.yml (PG 5433, CH 8123, Redis
# 6379, Redpanda 9092). Override via env if your stack lives elsewhere.
#
# Flags:
#   --no-lint          skip biome lint
#   --no-typecheck     skip tsc
#   --e2e-kafka        also run the kafkajs E2E (needs Redpanda)
#   --e2e-use-fixtures also run the USE_FIXTURES=0 E2E job
#   --soak[=MIN]       also run the compressed-proxy soak (default 1 min)
#   --only-probes      just check services, don't run anything

set -euo pipefail

# ------------------------------------------------------------------ args
RUN_LINT=1
RUN_TYPECHECK=1
RUN_E2E_KAFKA=0
RUN_E2E_USE_FIXTURES=0
RUN_SOAK=0
SOAK_MIN=1
ONLY_PROBES=0

for arg in "$@"; do
  case "$arg" in
    --no-lint) RUN_LINT=0 ;;
    --no-typecheck) RUN_TYPECHECK=0 ;;
    --e2e-kafka) RUN_E2E_KAFKA=1 ;;
    --e2e-use-fixtures) RUN_E2E_USE_FIXTURES=1 ;;
    --soak) RUN_SOAK=1 ;;
    --soak=*) RUN_SOAK=1; SOAK_MIN="${arg#*=}" ;;
    --only-probes) ONLY_PROBES=1 ;;
    *) echo "unknown arg: $arg" >&2; exit 2 ;;
  esac
done

# ------------------------------------------------------------------ env
export DATABASE_URL="${DATABASE_URL:-postgres://postgres:postgres@localhost:5433/bematist}"
export CLICKHOUSE_URL="${CLICKHOUSE_URL:-http://localhost:8123}"
export CLICKHOUSE_DATABASE="${CLICKHOUSE_DATABASE:-bematist}"
export REDIS_URL="${REDIS_URL:-redis://localhost:6379}"
export KAFKA_BROKERS="${KAFKA_BROKERS:-localhost:9092}"
# CH needs to reach PG for the dev_team_dict dictionary. In docker-compose.dev
# the CH container resolves `postgres` on the shared bridge network.
export CH_PG_DICT_HOST="${CH_PG_DICT_HOST:-postgres}"
export CH_PG_DICT_PORT="${CH_PG_DICT_PORT:-5432}"
# Opt into integration tests that TRUNCATE tables. Matches CI.
export PG_INTEGRATION_TESTS="${PG_INTEGRATION_TESTS:-1}"

# ------------------------------------------------------------------ probes
say() { printf "\n▸ %s\n" "$*"; }
check() {
  local label="$1" cmd="$2"
  printf "  %-42s " "$label"
  if eval "$cmd" >/dev/null 2>&1; then
    printf "ok\n"
  else
    printf "FAIL\n"
    printf "    cmd: %s\n" "$cmd" >&2
    exit 1
  fi
}

say "probing services"
check "postgres @ ${DATABASE_URL##*@}"  "docker exec bematist-postgres pg_isready -U postgres -d bematist"
check "clickhouse @ ${CLICKHOUSE_URL}"   "curl -sf ${CLICKHOUSE_URL}/ping"
check "redis @ ${REDIS_URL##*@}"         "docker exec bematist-redis redis-cli ping"
if [[ "$RUN_E2E_KAFKA" == "1" ]]; then
  check "redpanda cluster healthy" "docker exec bematist-redpanda rpk cluster health | grep -q 'Healthy:.*true'"
fi

if [[ "$ONLY_PROBES" == "1" ]]; then exit 0; fi

# ------------------------------------------------------------------ migrate
say "migrations · postgres"
bun run db:migrate:pg
say "migrations · clickhouse"
bun run db:migrate:ch

# ------------------------------------------------------------------ lint / tc
if [[ "$RUN_LINT" == "1" ]]; then
  say "lint (biome)"
  bun run lint
fi

if [[ "$RUN_TYPECHECK" == "1" ]]; then
  say "typecheck"
  bun run typecheck
fi

# ------------------------------------------------------------------ test
# Go through `bun test` directly (not `bun run test`) so we can raise the
# per-test default timeout. The dry-run collector test does a cold `await
# import(...)` inside a 5 s default window and times out on cold runs
# (~18 s observed). Keeping CI parity otherwise.
say "test (PG_INTEGRATION_TESTS=1, --timeout 30000)"
bun --env-file=.env test --timeout 30000

# ------------------------------------------------------------------ opt-ins
if [[ "$RUN_E2E_USE_FIXTURES" == "1" ]]; then
  say "e2e · USE_FIXTURES=0"
  TEST_E2E=1 E2E_INGEST_PORT="${E2E_INGEST_PORT:-8767}" \
    bun test apps/web/integration-tests/use-fixtures-0.test.ts
fi

if [[ "$RUN_E2E_KAFKA" == "1" ]]; then
  say "e2e · kafka (Redpanda)"
  E2E_KAFKA=1 bun test apps/worker/src/github/kafkaE2E.test.ts
fi

if [[ "$RUN_SOAK" == "1" ]]; then
  say "soak · compressed proxy (${SOAK_MIN} min)"
  SOAK_COMPRESSED_MINUTES="$SOAK_MIN" bun test tests/soak/compressed-proxy.test.ts
fi

say "all green"
