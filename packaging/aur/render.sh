#!/usr/bin/env bash
# packaging/aur/render.sh
# Emit a PKGBUILD with version + sha256 values substituted in. Inputs match
# render.sh conventions across packaging/.
#
# Resilience: if only one of linux-x64 / linux-arm64 is present, we emit only
# the matching `source_*` / `sha256sums_*` array and trim the `arch=(...)`
# tuple accordingly. Fails hard if both linux binaries are missing (AUR is
# linux-only — nothing to render). See tests/packaging/render-resilience.sh.
set -euo pipefail

version="$1"
repo="$2"
dist="$3"

here="$(cd "$(dirname "$0")" && pwd)"
tmpl="$here/PKGBUILD.tmpl"

digest() {
  local f="$1"
  if [[ ! -f "$f" ]]; then
    echo "render.sh: missing $f — skipping" >&2
    return 0
  fi
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$f" | awk '{print $1}'
  else
    shasum -a 256 "$f" | awk '{print $1}'
  fi
}

lx=$(digest "$dist/bematist-v${version}-linux-x64")
la=$(digest "$dist/bematist-v${version}-linux-arm64")

if [[ -z "$lx" && -z "$la" ]]; then
  echo "render.sh: no linux binaries found in $dist (AUR is linux-only)" >&2
  exit 1
fi

# Compose arch tuple + source/sha256 arrays only for present targets.
arch_tuple=""
src_blocks=""
append_src_block() {
  # $1 = arch suffix (x86_64|aarch64), $2 = target slug (linux-x64|linux-arm64), $3 = sha
  local aur_arch="$1"
  local target="$2"
  local sha="$3"
  local block
  block="source_${aur_arch}=(\"https://github.com/${repo}/releases/download/v\${pkgver}/bematist-v\${pkgver}-${target}\")
sha256sums_${aur_arch}=('${sha}')"
  if [[ -n "$src_blocks" ]]; then
    src_blocks="${src_blocks}
${block}"
  else
    src_blocks="$block"
  fi
}

if [[ -n "$lx" ]]; then
  arch_tuple="'x86_64'"
  append_src_block "x86_64" "linux-x64" "$lx"
fi
if [[ -n "$la" ]]; then
  if [[ -n "$arch_tuple" ]]; then
    arch_tuple="${arch_tuple} 'aarch64'"
  else
    arch_tuple="'aarch64'"
  fi
  append_src_block "aarch64" "linux-arm64" "$la"
fi

# BSD awk rejects embedded newlines in -v values — stream source arrays
# through a temp file instead.
src_file="$(mktemp "${TMPDIR:-/tmp}/bematist-aur-src.XXXXXX")"
trap 'rm -f "$src_file"' EXIT
printf '%s\n' "$src_blocks" > "$src_file"

awk -v ver="$version" -v repo="$repo" -v arches="$arch_tuple" -v src_file="$src_file" '
  {
    gsub(/@VERSION@/, ver)
    gsub(/@REPO@/, repo)
    gsub(/@ARCH_TUPLE@/, arches)
    if ($0 ~ /^@SOURCE_ARRAYS@$/) {
      while ((getline line < src_file) > 0) print line
      close(src_file)
      next
    }
    print
  }
' "$tmpl"
