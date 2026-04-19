#!/usr/bin/env bash
# packaging/deb/render.sh
#
# Iterate over the linux-amd64 + linux-arm64 debian targets and call
# packaging/deb/build.sh for each one whose source binary is present in $dist.
# Inputs:
#   $1  version (e.g. "0.1.0")
#   $2  GitHub repo slug (unused; accepted to match the render.sh convention
#       across packaging/)
#   $3  directory holding the built binaries named `bematist-v<ver>-<os>-<arch>`
#
# Resilience: missing linux binaries are warned-and-skipped. Fails hard if
# neither linux-x64 nor linux-arm64 is present. See
# tests/packaging/render-resilience.sh.
set -euo pipefail

version="$1"
# shellcheck disable=SC2034  # accepted for convention; not used here
repo="$2"
dist="$3"

here="$(cd "$(dirname "$0")" && pwd)"

declare -a pairs=(
  "linux-x64:amd64"
  "linux-arm64:arm64"
)

built_any=0
for pair in "${pairs[@]}"; do
  src_arch="${pair%%:*}"
  deb_arch="${pair##*:}"
  binary="$dist/bematist-v${version}-${src_arch}"
  if [[ ! -f "$binary" ]]; then
    echo "render.sh: missing $binary — skipping .deb for $deb_arch" >&2
    continue
  fi
  out="$dist/bematist_${version}_${deb_arch}.deb"
  bash "$here/build.sh" "$version" "$binary" "$out" "$deb_arch"
  built_any=1
done

if [[ $built_any -eq 0 ]]; then
  echo "render.sh: no linux binaries found in $dist (nothing to build)" >&2
  exit 1
fi
