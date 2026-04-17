#!/usr/bin/env bash
# tests/perf/run.sh
#
# Entry point for `bun run test:perf`. Runs k6 against a live dev/prod server.
# Non-gating by default (today's p(95)<3s is warn-level); the M2 gate
# (p(95)<2s abortOnFail) flips on by exporting K6_GATE_M2=1.
#
# Exits with k6's exit code so CI can treat the gating decision consistently.
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
GATE_M2="${K6_GATE_M2:-0}"
SCRIPT="tests/perf/dashboard.k6.js"

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

banner "probing ${BASE_URL} …"
if ! curl -fsS -o /dev/null --max-time 5 "${BASE_URL}/"; then
  warn "${BASE_URL}/ is not responding — start the dev server first (\`bun run dev\`)."
  exit 1
fi

if [ "${GATE_M2}" = "1" ]; then
  banner "M2 gate ENABLED — p(95)<2s is abortOnFail (merge-blocking)."
else
  banner "M2 gate disabled — p(95)<3s warn-level only. Export K6_GATE_M2=1 to gate."
fi

banner "running ${SCRIPT} against ${BASE_URL}"
BASE_URL="${BASE_URL}" K6_GATE_M2="${GATE_M2}" \
  k6 run \
    --quiet \
    --summary-export=tests/perf/summary.json \
    "${SCRIPT}"
