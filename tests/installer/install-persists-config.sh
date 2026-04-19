#!/usr/bin/env bash
# tests/installer/install-persists-config.sh
#
# Black-box integration test for packaging/install.sh's config-persistence
# path. Runs install.sh with --config-only so no binary download happens.
#
# Asserts:
#   - ~/.bematist/config.env is created at mode 0600
#   - BEMATIST_ENDPOINT=<flag value> and BEMATIST_TOKEN=<flag value>
#     are both present
#   - Re-running with only --endpoint preserves the prior token (and vice versa)
#   - Malformed invocation (neither flag, --config-only) exits non-zero
#
# Usage: bash tests/installer/install-persists-config.sh
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
repo_root="$(cd "$here/../.." && pwd)"
installer="$repo_root/packaging/install.sh"

tmp=$(mktemp -d -t bematist-installer-test.XXXXXX)
trap 'rm -rf "$tmp"' EXIT

export BEMATIST_DATA_DIR="$tmp/.bematist"
export BEMATIST_CONFIG_ENV_PATH="$BEMATIST_DATA_DIR/config.env"

say() { printf '  test: %s\n' "$*"; }
fail() { printf '  FAIL: %s\n' "$*" >&2; exit 1; }

# ---- Case 1: fresh install with both flags ----
say "case 1: fresh install with --endpoint + --token"
sh "$installer" --config-only \
  --endpoint https://ingest.example.test \
  --token bm_orgslug_keyid_secret >"$tmp/out1" 2>&1 || {
  cat "$tmp/out1"
  fail "installer exited non-zero with both flags"
}

[ -f "$BEMATIST_CONFIG_ENV_PATH" ] || fail "config.env not written"

# Mode check (POSIX — macOS stat vs GNU stat differ; use ls parse).
mode=$(ls -l "$BEMATIST_CONFIG_ENV_PATH" | awk '{ print $1 }')
case "$mode" in
  -rw-------) ;;
  *) fail "config.env mode is $mode, expected -rw-------" ;;
esac

grep -q "^BEMATIST_ENDPOINT=https://ingest.example.test$" "$BEMATIST_CONFIG_ENV_PATH" || \
  fail "endpoint not persisted"
grep -q "^BEMATIST_TOKEN=bm_orgslug_keyid_secret$" "$BEMATIST_CONFIG_ENV_PATH" || \
  fail "token not persisted"

# ---- Case 2: re-run with only --endpoint preserves prior token ----
say "case 2: re-run with only --endpoint preserves token"
sh "$installer" --config-only \
  --endpoint https://ingest.newhost.test >"$tmp/out2" 2>&1 || {
  cat "$tmp/out2"
  fail "installer exited non-zero on re-run"
}

grep -q "^BEMATIST_ENDPOINT=https://ingest.newhost.test$" "$BEMATIST_CONFIG_ENV_PATH" || \
  fail "endpoint not updated on re-run"
grep -q "^BEMATIST_TOKEN=bm_orgslug_keyid_secret$" "$BEMATIST_CONFIG_ENV_PATH" || \
  fail "token lost on endpoint-only re-run"

# ---- Case 3: re-run with only --token preserves new endpoint ----
say "case 3: re-run with only --token preserves new endpoint"
sh "$installer" --config-only \
  --token bm_newtoken_abc >"$tmp/out3" 2>&1 || {
  cat "$tmp/out3"
  fail "installer exited non-zero on token-only re-run"
}

grep -q "^BEMATIST_ENDPOINT=https://ingest.newhost.test$" "$BEMATIST_CONFIG_ENV_PATH" || \
  fail "endpoint lost on token-only re-run"
grep -q "^BEMATIST_TOKEN=bm_newtoken_abc$" "$BEMATIST_CONFIG_ENV_PATH" || \
  fail "token not updated on re-run"

# ---- Case 4: --config-only without flags is an error ----
say "case 4: --config-only with no flags exits non-zero"
rm -f "$BEMATIST_CONFIG_ENV_PATH"
if sh "$installer" --config-only >"$tmp/out4" 2>&1; then
  cat "$tmp/out4"
  fail "installer should exit non-zero when --config-only given no flags"
fi

# ---- Case 5: env var flags work too ----
say "case 5: BEMATIST_ENDPOINT / BEMATIST_TOKEN env vars route into write_config"
rm -f "$BEMATIST_CONFIG_ENV_PATH"
BEMATIST_ENDPOINT=https://from-env.test \
BEMATIST_TOKEN=bm_from_env_xyz \
sh "$installer" --config-only >"$tmp/out5" 2>&1 || {
  cat "$tmp/out5"
  fail "env-var flow exited non-zero"
}

grep -q "^BEMATIST_ENDPOINT=https://from-env.test$" "$BEMATIST_CONFIG_ENV_PATH" || \
  fail "env-var endpoint not persisted"
grep -q "^BEMATIST_TOKEN=bm_from_env_xyz$" "$BEMATIST_CONFIG_ENV_PATH" || \
  fail "env-var token not persisted"

say "all installer config-persistence cases passed"
