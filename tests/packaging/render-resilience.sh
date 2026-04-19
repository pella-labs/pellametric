#!/usr/bin/env bash
# tests/packaging/render-resilience.sh
#
# Acceptance tests for packaging/*/render.sh graceful-skip behavior (M5 F3).
# Covers three scenarios:
#   1. v0.1.x reality — darwin-x64 missing, other 4 present.
#   2. linux-only — only linux-x64 + linux-arm64 present (no macos/windows).
#   3. empty — no binaries; every render.sh must fail with a clear error,
#      except choco which exits 0 with a "skipping" message.
#
# Run with:  bash tests/packaging/render-resilience.sh
# CI wires this into the release packaging job to prevent regressions.
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$repo_root"

version="0.1.0"
repo="bematist-org/bematist"

pass=0
fail=0
failures=()

log()  { printf '  %s\n' "$*"; }
ok()   { printf '  OK  %s\n' "$*"; pass=$((pass+1)); }
bad()  { printf '  FAIL  %s\n' "$*" >&2; fail=$((fail+1)); failures+=("$*"); }

# --- helpers ----------------------------------------------------------------

make_dist() {
  # Creates a fresh temp $dist populated with dummy binaries for each target
  # name passed in. Returns the dir path on stdout.
  local dist
  dist="$(mktemp -d "${TMPDIR:-/tmp}/bematist-rendertest.XXXXXX")"
  local target
  for target in "$@"; do
    dd if=/dev/urandom of="$dist/$target" bs=1k count=1 >/dev/null 2>&1
  done
  echo "$dist"
}

run() {
  # Run a script, capture exit code + combined output. Usage:
  #   run <label> <expected_rc> -- <cmd...>
  local label="$1" ; shift
  local expect_rc="$1" ; shift
  [[ "$1" == "--" ]] && shift
  local out rc=0
  out="$("$@" 2>&1)" || rc=$?
  if [[ "$rc" -eq "$expect_rc" ]]; then
    ok "$label (rc=$rc as expected)"
  else
    bad "$label — expected rc=$expect_rc, got rc=$rc"
    printf '%s\n' "$out" | sed 's/^/      > /' >&2
  fi
  printf '%s\n' "$out"
}

contains() {
  # assert that stdin contains a regex pattern
  local label="$1" pattern="$2"
  local buf; buf="$(cat)"
  if grep -Eq "$pattern" <<<"$buf"; then
    ok "$label contains /${pattern}/"
  else
    bad "$label MISSING /${pattern}/"
    printf '%s\n' "$buf" | sed 's/^/      > /' >&2
  fi
}

not_contains() {
  local label="$1" pattern="$2"
  local buf; buf="$(cat)"
  if grep -Eq "$pattern" <<<"$buf"; then
    bad "$label unexpectedly contains /${pattern}/"
    printf '%s\n' "$buf" | sed 's/^/      > /' >&2
  else
    ok "$label does not contain /${pattern}/"
  fi
}

# --- scenario 1: v0.1.x reality (darwin-x64 missing) ------------------------

echo
echo "Scenario 1: v0.1.x reality — darwin-x64 missing, rest present"
dist1=$(make_dist \
  "bematist-v${version}-darwin-arm64" \
  "bematist-v${version}-linux-x64" \
  "bematist-v${version}-linux-arm64" \
  "bematist-v${version}-windows-x64.exe")

# Homebrew — should emit on_macos (arm64 only) + on_linux (both arches).
brew_out=$(bash packaging/homebrew/render.sh "$version" "$repo" "$dist1" 2>/dev/null) \
  || { bad "homebrew render scenario1 exited non-zero"; brew_out=""; }
if [[ -n "$brew_out" ]]; then
  ok "homebrew render scenario1 exited 0"
  printf '%s\n' "$brew_out" | contains "homebrew s1: has on_macos"  'on_macos do'
  printf '%s\n' "$brew_out" | contains "homebrew s1: has on_linux"  'on_linux do'
  # darwin-x64 was dropped: the single-arch macos branch must NOT reference darwin-x64
  printf '%s\n' "$brew_out" | not_contains "homebrew s1: no darwin-x64 ref" 'darwin-x64'
  printf '%s\n' "$brew_out" | contains "homebrew s1: darwin-arm64 url"  'bematist-v#\{version\}-darwin-arm64'
  printf '%s\n' "$brew_out" | contains "homebrew s1: linux-x64 url"     'bematist-v#\{version\}-linux-x64'
  printf '%s\n' "$brew_out" | contains "homebrew s1: linux-arm64 url"   'bematist-v#\{version\}-linux-arm64'
fi

# AUR — both linux arches present → both arrays + both arches in tuple.
aur_out=$(bash packaging/aur/render.sh "$version" "$repo" "$dist1" 2>/dev/null) \
  || { bad "aur render scenario1 exited non-zero"; aur_out=""; }
if [[ -n "$aur_out" ]]; then
  ok "aur render scenario1 exited 0"
  printf '%s\n' "$aur_out" | contains "aur s1: arch tuple x86_64+aarch64" "arch=\('x86_64' 'aarch64'\)"
  printf '%s\n' "$aur_out" | contains "aur s1: source_x86_64"   'source_x86_64=\('
  printf '%s\n' "$aur_out" | contains "aur s1: source_aarch64"  'source_aarch64=\('
fi

# Choco — windows-x64.exe present → success + nuspec written.
if bash packaging/choco/render.sh "$version" "$repo" "$dist1" >/dev/null 2>&1; then
  ok "choco render scenario1 exited 0"
  [[ -f "$dist1/bematist.nuspec" ]] && ok "choco s1: nuspec written" || bad "choco s1: nuspec missing"
  [[ -f "$dist1/tools/chocolateyInstall.ps1" ]] && ok "choco s1: ps1 written" || bad "choco s1: ps1 missing"
else
  bad "choco render scenario1 failed"
fi

# Deb — both linux present → two .deb files (skip if dpkg-deb missing).
if command -v dpkg-deb >/dev/null 2>&1; then
  if bash packaging/deb/render.sh "$version" "$repo" "$dist1" >/dev/null 2>&1; then
    ok "deb render scenario1 exited 0"
    [[ -f "$dist1/bematist_${version}_amd64.deb" ]] && ok "deb s1: amd64 .deb built" || bad "deb s1: amd64 .deb missing"
    [[ -f "$dist1/bematist_${version}_arm64.deb" ]] && ok "deb s1: arm64 .deb built" || bad "deb s1: arm64 .deb missing"
  else
    bad "deb render scenario1 failed"
  fi
else
  log "deb render scenario1: skipping (dpkg-deb not installed — expected on darwin)"
fi

rm -rf "$dist1"

# --- scenario 2: linux-only -------------------------------------------------

echo
echo "Scenario 2: linux-only — no macos or windows binaries"
dist2=$(make_dist \
  "bematist-v${version}-linux-x64" \
  "bematist-v${version}-linux-arm64")

brew_out=$(bash packaging/homebrew/render.sh "$version" "$repo" "$dist2" 2>/dev/null) \
  || { bad "homebrew render scenario2 exited non-zero"; brew_out=""; }
if [[ -n "$brew_out" ]]; then
  ok "homebrew render scenario2 exited 0"
  printf '%s\n' "$brew_out" | not_contains "homebrew s2: no on_macos block" 'on_macos do'
  printf '%s\n' "$brew_out" | contains     "homebrew s2: has on_linux block" 'on_linux do'
fi

aur_out=$(bash packaging/aur/render.sh "$version" "$repo" "$dist2" 2>/dev/null) \
  || { bad "aur render scenario2 exited non-zero"; aur_out=""; }
if [[ -n "$aur_out" ]]; then
  ok "aur render scenario2 exited 0"
  printf '%s\n' "$aur_out" | contains "aur s2: arch tuple x86_64+aarch64" "arch=\('x86_64' 'aarch64'\)"
fi

# Choco — no windows binary → exit 0 with "skipping".
choco_out=$(bash packaging/choco/render.sh "$version" "$repo" "$dist2" 2>&1) && choco_rc=0 || choco_rc=$?
if [[ "$choco_rc" -eq 0 ]]; then
  ok "choco render scenario2 exited 0 (skipping)"
  printf '%s\n' "$choco_out" | contains "choco s2: skipping message" 'skipping choco'
  [[ ! -f "$dist2/bematist.nuspec" ]] && ok "choco s2: no nuspec emitted" || bad "choco s2: nuspec unexpectedly written"
else
  bad "choco render scenario2 — expected rc=0 with skip message, got rc=$choco_rc"
fi

if command -v dpkg-deb >/dev/null 2>&1; then
  if bash packaging/deb/render.sh "$version" "$repo" "$dist2" >/dev/null 2>&1; then
    ok "deb render scenario2 exited 0"
  else
    bad "deb render scenario2 failed"
  fi
else
  log "deb render scenario2: skipping (dpkg-deb not installed)"
fi

rm -rf "$dist2"

# --- scenario 3: empty dist -------------------------------------------------

echo
echo "Scenario 3: empty dist — every render must fail (choco exits 0 with skip)"
dist3="$(mktemp -d "${TMPDIR:-/tmp}/bematist-rendertest.XXXXXX")"

# Homebrew — both OS blocks empty → exit 1 with clear error.
brew_out=$(bash packaging/homebrew/render.sh "$version" "$repo" "$dist3" 2>&1) && brew_rc=0 || brew_rc=$?
if [[ "$brew_rc" -ne 0 ]]; then
  ok "homebrew render scenario3 failed as expected (rc=$brew_rc)"
  printf '%s\n' "$brew_out" | contains "homebrew s3: error message" 'no darwin or linux binaries'
else
  bad "homebrew render scenario3 unexpectedly succeeded"
fi

# AUR — no linux binaries → exit 1.
aur_out=$(bash packaging/aur/render.sh "$version" "$repo" "$dist3" 2>&1) && aur_rc=0 || aur_rc=$?
if [[ "$aur_rc" -ne 0 ]]; then
  ok "aur render scenario3 failed as expected (rc=$aur_rc)"
  printf '%s\n' "$aur_out" | contains "aur s3: error message" 'no linux binaries'
else
  bad "aur render scenario3 unexpectedly succeeded"
fi

# Choco — no windows binary → exit 0 with skip message (genuine no-op).
choco_out=$(bash packaging/choco/render.sh "$version" "$repo" "$dist3" 2>&1) && choco_rc=0 || choco_rc=$?
if [[ "$choco_rc" -eq 0 ]]; then
  ok "choco render scenario3 exited 0 (genuine no-op)"
  printf '%s\n' "$choco_out" | contains "choco s3: skipping message" 'skipping choco'
else
  bad "choco render scenario3 — expected rc=0 with skip, got rc=$choco_rc"
fi

# Deb — no linux binaries → exit 1 (wrapper).
deb_out=$(bash packaging/deb/render.sh "$version" "$repo" "$dist3" 2>&1) && deb_rc=0 || deb_rc=$?
if [[ "$deb_rc" -ne 0 ]]; then
  ok "deb render scenario3 failed as expected (rc=$deb_rc)"
  printf '%s\n' "$deb_out" | contains "deb s3: error message" 'no linux binaries'
else
  bad "deb render scenario3 unexpectedly succeeded"
fi

rm -rf "$dist3"

# --- summary ---------------------------------------------------------------

echo
echo "-------- summary --------"
echo "  pass: $pass"
echo "  fail: $fail"
if [[ $fail -gt 0 ]]; then
  echo
  echo "Failures:"
  for f in "${failures[@]}"; do
    echo "  - $f"
  done
  exit 1
fi
echo
echo "All render-resilience tests passed."
