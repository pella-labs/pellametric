#!/usr/bin/env bash
# packaging/deb/build.sh
#
# Build a minimal .deb package containing the pre-compiled `bematist` binary.
# Inputs:
#   $1  version (e.g. "0.1.0")
#   $2  path to the pre-compiled binary
#   $3  output .deb path
#   $4  architecture ("amd64" | "arm64")
#
# Requires `dpkg-deb` (ships on ubuntu-latest runners).
set -euo pipefail

version="$1"
binary="$2"
out="$3"
arch="$4"

if [[ ! -f "$binary" ]]; then
  echo "build.sh: missing binary $binary — cannot build $arch .deb" >&2
  echo "build.sh: use packaging/deb/render.sh to iterate + skip missing arches" >&2
  exit 1
fi

here="$(cd "$(dirname "$0")" && pwd)"
stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT

mkdir -p "$stage/DEBIAN" "$stage/usr/local/bin"
sed \
  -e "s|@VERSION@|${version}|g" \
  -e "s|@ARCH@|${arch}|g" \
  "$here/control.tmpl" > "$stage/DEBIAN/control"

install -m 0755 "$binary" "$stage/usr/local/bin/bematist"

mkdir -p "$(dirname "$out")"
dpkg-deb --build --root-owner-group "$stage" "$out"
echo "built: $out"
