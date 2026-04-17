#!/usr/bin/env bash
# packaging/aur/render.sh
# Emit a PKGBUILD with version + sha256 values substituted in. Inputs match
# render.sh conventions across packaging/.
set -euo pipefail

version="$1"
repo="$2"
dist="$3"

here="$(cd "$(dirname "$0")" && pwd)"
tmpl="$here/PKGBUILD.tmpl"

digest() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

lx=$(digest "$dist/bematist-v${version}-linux-x64")
la=$(digest "$dist/bematist-v${version}-linux-arm64")

sed \
  -e "s|@VERSION@|${version}|g" \
  -e "s|@REPO@|${repo}|g" \
  -e "s|@SHA256_LINUX_X64@|${lx}|g" \
  -e "s|@SHA256_LINUX_ARM64@|${la}|g" \
  "$tmpl"
