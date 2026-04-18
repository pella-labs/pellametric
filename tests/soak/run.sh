#!/usr/bin/env bash
# tests/soak/run.sh — operator wrapper for the F15 / INT0 24-hour soak.
#
# Runs the Bun soak harness with output teed to a timestamped log and, on
# completion, prints the summary JSON and pastes it into dev-docs/soak-result-m2.md.
# Does NOT start the dev stack — operator responsibility. Assumes:
#   - docker compose -f docker-compose.dev.yml up -d
#   - apps/ingest running against that stack
#   - bun run seed:perf has minted tests/perf/.ingest-bearer
#
# Usage:
#   tests/soak/run.sh                       # full 24h
#   tests/soak/run.sh --hours=0.1           # 6-minute smoke
#   HOURS=24 RATE=100 tests/soak/run.sh     # env form

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

OUT_DIR="${SOAK_OUT_DIR:-tests/soak/out}"
mkdir -p "$OUT_DIR"

RUN_ID="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
LOG="${OUT_DIR}/run-${RUN_ID}.log"

HOURS_FLAG=""
RATE_FLAG=""
BATCH_FLAG=""
for arg in "$@"; do
  case "$arg" in
    --hours=*) HOURS_FLAG="$arg" ;;
    --rate=*) RATE_FLAG="$arg" ;;
    --batch=*) BATCH_FLAG="$arg" ;;
    *) echo "[soak] ignoring unknown arg: $arg" >&2 ;;
  esac
done
if [ -z "$HOURS_FLAG" ] && [ -n "${HOURS:-}" ]; then HOURS_FLAG="--hours=${HOURS}"; fi
if [ -z "$RATE_FLAG" ] && [ -n "${RATE:-}" ]; then RATE_FLAG="--rate=${RATE}"; fi
if [ -z "$BATCH_FLAG" ] && [ -n "${BATCH:-}" ]; then BATCH_FLAG="--batch=${BATCH}"; fi

echo "[soak] starting run ${RUN_ID} — log ${LOG}"
set +e
bun run tests/soak/ingest-clickhouse-soak.ts \
  ${HOURS_FLAG:-} ${RATE_FLAG:-} ${BATCH_FLAG:-} \
  --out="${OUT_DIR}" 2>&1 | tee "$LOG"
status="${PIPESTATUS[0]}"
set -e

LATEST_SUMMARY="$(ls -1t "${OUT_DIR}"/summary-*.json 2>/dev/null | head -1 || true)"
if [ -n "$LATEST_SUMMARY" ]; then
  echo "[soak] summary: $LATEST_SUMMARY"
  cat "$LATEST_SUMMARY"
else
  echo "[soak] no summary file found; harness likely died before emitting one" >&2
fi

echo "[soak] exit status: $status"
exit "$status"
