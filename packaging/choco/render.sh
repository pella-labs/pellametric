#!/usr/bin/env bash
# packaging/choco/render.sh
# Write `$dist/bematist.nuspec` and `$dist/tools/chocolateyInstall.ps1` with
# substituted values.
#
# Resilience: Chocolatey is windows-only. If `bematist-v<ver>-windows-x64.exe`
# is not in $dist (e.g. the windows build was skipped for this release), we
# exit 0 with a "skipping" message — the release workflow then has no choco
# artifacts to publish, which is the honest state, not an error. See
# tests/packaging/render-resilience.sh.
set -euo pipefail

version="$1"
repo="$2"
dist="$3"

here="$(cd "$(dirname "$0")" && pwd)"

digest() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

win_binary="$dist/bematist-v${version}-windows-x64.exe"
if [[ ! -f "$win_binary" ]]; then
  echo "render.sh: skipping choco — no windows binary ($win_binary)" >&2
  exit 0
fi

wx=$(digest "$win_binary")

mkdir -p "$dist/tools"

sed \
  -e "s|@VERSION@|${version}|g" \
  -e "s|@REPO@|${repo}|g" \
  "$here/bematist.nuspec.tmpl" > "$dist/bematist.nuspec"

sed \
  -e "s|@VERSION@|${version}|g" \
  -e "s|@REPO@|${repo}|g" \
  -e "s|@SHA256_WINDOWS_X64@|${wx}|g" \
  "$here/chocolateyInstall.ps1.tmpl" > "$dist/tools/chocolateyInstall.ps1"

echo "rendered: $dist/bematist.nuspec"
echo "rendered: $dist/tools/chocolateyInstall.ps1"
