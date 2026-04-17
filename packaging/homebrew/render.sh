#!/usr/bin/env bash
# packaging/homebrew/render.sh
#
# Substitute release metadata into the Homebrew formula template and print the
# rendered formula to stdout. Inputs:
#   $1  version (e.g. "0.1.0")
#   $2  GitHub repo slug (e.g. "bematist-org/bematist")
#   $3  directory holding the built binaries named `bematist-v<ver>-<os>-<arch>`
set -euo pipefail

version="$1"
repo="$2"
dist="$3"

here="$(cd "$(dirname "$0")" && pwd)"
tmpl="$here/bematist.rb.tmpl"

digest() {
  local f="$1"
  if [[ ! -f "$f" ]]; then
    echo "render.sh: missing binary $f" >&2
    exit 1
  fi
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$f" | awk '{print $1}'
  else
    shasum -a 256 "$f" | awk '{print $1}'
  fi
}

dx=$(digest "$dist/bematist-v${version}-darwin-x64")
da=$(digest "$dist/bematist-v${version}-darwin-arm64")
lx=$(digest "$dist/bematist-v${version}-linux-x64")
la=$(digest "$dist/bematist-v${version}-linux-arm64")

sed \
  -e "s|@VERSION@|${version}|g" \
  -e "s|@REPO@|${repo}|g" \
  -e "s|@SHA256_DARWIN_X64@|${dx}|g" \
  -e "s|@SHA256_DARWIN_ARM64@|${da}|g" \
  -e "s|@SHA256_LINUX_X64@|${lx}|g" \
  -e "s|@SHA256_LINUX_ARM64@|${la}|g" \
  "$tmpl"
