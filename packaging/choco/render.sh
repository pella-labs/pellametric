#!/usr/bin/env bash
# packaging/choco/render.sh
# Write `$dist/bematist.nuspec` and `$dist/tools/chocolateyInstall.ps1` with
# substituted values.
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

wx=$(digest "$dist/bematist-v${version}-windows-x64.exe")

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
