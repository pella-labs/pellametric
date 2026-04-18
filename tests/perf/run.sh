#!/usr/bin/env bash
# tests/perf/run.sh
#
# Entry point for `bun run test:perf`. Runs the M2 perf gate harness against a
# live dev/prod stack:
#   - tests/perf/dashboard.k6.js — p95 < 2s on 1M-seeded events
#   - tests/perf/ingest.k6.js    — p99 < 100ms at 1k ev/s sustained
#
# Both gates are MERGE BLOCKING per CLAUDE.md §Key Constraints. The gate is on
# by default; export K6_GATE_M2=0 to run warn-only locally.
#
# Usage:
#   tests/perf/run.sh                   # both gates
#   tests/perf/run.sh dashboard         # dashboard only
#   tests/perf/run.sh ingest            # ingest only
#
# Env:
#   BASE_URL          default http://localhost:3000
#   INGEST_URL        default http://localhost:8000
#   INGEST_BEARER     bearer key for /v1/events (perf tenant). Read from
#                     PERF_INGEST_BEARER_PATH if unset (the seed writes it
#                     to tests/perf/.ingest-bearer).
#   K6_GATE_M2        '0' to disable strict abortOnFail (default '1' = on)
#
# Exits with the FIRST non-zero k6 exit code so CI fails closed on any gate.

set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
INGEST_URL="${INGEST_URL:-http://localhost:8000}"
GATE_M2="${K6_GATE_M2:-1}"
TARGETS="${1:-both}"

banner() { printf '\n  [perf] %s\n' "$*"; }
warn() { printf '  [perf] %s\n' "$*" >&2; }

if ! command -v k6 >/dev/null 2>&1; then
  cat >&2 <<'EOF'

  [perf] k6 is not installed. Options:
         macOS:    brew install k6
         linux:    see https://k6.io/docs/get-started/installation/
         docker:   docker run --rm -i --network=host grafana/k6 run - < tests/perf/dashboard.k6.js

EOF
  exit 127
fi

probe() {
  local url="$1"
  local label="$2"
  if ! curl -fsS -o /dev/null --max-time 5 "$url"; then
    warn "$label at $url is not responding — start it first."
    return 1
  fi
}

if [ "$GATE_M2" = "1" ]; then
  banner "M2 gate ENABLED — p(95) dash <2s + p(99) ingest <100ms are merge-blocking."
else
  banner "M2 gate DISABLED — warn-level only. Export K6_GATE_M2=1 to gate."
fi

# Best-effort: pick up the seed-minted bearer if INGEST_BEARER not already set.
if [ -z "${INGEST_BEARER:-}" ]; then
  bearer_path="${PERF_INGEST_BEARER_PATH:-tests/perf/.ingest-bearer}"
  if [ -f "$bearer_path" ]; then
    INGEST_BEARER="$(tr -d '\n' < "$bearer_path")"
    export INGEST_BEARER
    banner "loaded INGEST_BEARER from ${bearer_path}"
  fi
fi

run_dashboard() {
  banner "probing ${BASE_URL} …"
  probe "${BASE_URL}/" "web" || return 1
  banner "running tests/perf/dashboard.k6.js against ${BASE_URL}"
  BASE_URL="${BASE_URL}" K6_GATE_M2="${GATE_M2}" \
    k6 run \
      --quiet \
      --summary-export=tests/perf/summary.json \
      tests/perf/dashboard.k6.js
}

run_ingest() {
  banner "probing ${INGEST_URL}/healthz …"
  probe "${INGEST_URL}/healthz" "ingest" || return 1
  banner "running tests/perf/ingest.k6.js against ${INGEST_URL}"
  INGEST_URL="${INGEST_URL}" K6_GATE_M2="${GATE_M2}" \
    INGEST_BEARER="${INGEST_BEARER:-}" \
    k6 run \
      --quiet \
      --summary-export=tests/perf/ingest-summary.json \
      tests/perf/ingest.k6.js
}

# Track the worst exit code so partial-fails still surface upstream.
overall=0
case "$TARGETS" in
  dashboard)
    run_dashboard || overall=$?
    ;;
  ingest)
    run_ingest || overall=$?
    ;;
  both|"")
    run_dashboard || overall=$?
    run_ingest    || overall=$?
    ;;
  *)
    warn "unknown target: $TARGETS (expected: dashboard | ingest | both)"
    exit 2
    ;;
esac

exit "$overall"
