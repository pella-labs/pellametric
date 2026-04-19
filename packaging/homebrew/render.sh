#!/usr/bin/env bash
# packaging/homebrew/render.sh
#
# Substitute release metadata into the Homebrew formula template and print the
# rendered formula to stdout. Inputs:
#   $1  version (e.g. "0.1.0")
#   $2  GitHub repo slug (e.g. "bematist-org/bematist")
#   $3  directory holding the built binaries named `bematist-v<ver>-<os>-<arch>`
#
# Resilience: binaries for any target that doesn't exist in $dist are skipped
# cleanly (warning to stderr, no exit). We emit the `on_macos do … end` block
# only if at least one darwin binary is present; ditto `on_linux do … end`.
# This lets v0.1.x ship with darwin-x64 temporarily missing without failing
# the release workflow. See tests/packaging/render-resilience.sh for the
# acceptance suite.
set -euo pipefail

version="$1"
repo="$2"
dist="$3"

here="$(cd "$(dirname "$0")" && pwd)"
tmpl="$here/bematist.rb.tmpl"

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

# SHA-256 per target — empty string when the binary isn't present.
dx=$(digest "$dist/bematist-v${version}-darwin-x64")
da=$(digest "$dist/bematist-v${version}-darwin-arm64")
lx=$(digest "$dist/bematist-v${version}-linux-x64")
la=$(digest "$dist/bematist-v${version}-linux-arm64")

if [[ -z "$dx" && -z "$da" && -z "$lx" && -z "$la" ]]; then
  echo "render.sh: no darwin or linux binaries found in $dist" >&2
  exit 1
fi

# Render the helper that emits an `on_<os>` block for one OS family. Given
# the two arch-slots (arm64, x64) and their digests, it emits:
#   - nothing at all if both digests are empty
#   - a single unconditional url/sha256 pair if only one arch is present
#   - the conditional Hardware::CPU.arm? branch if both are present
emit_os_block() {
  local os="$1"          # "macos" | "linux"
  local os_slug="$2"     # "darwin" | "linux"
  local arm_sha="$3"
  local x64_sha="$4"

  if [[ -z "$arm_sha" && -z "$x64_sha" ]]; then
    return 0
  fi

  printf '  on_%s do\n' "$os"
  if [[ -n "$arm_sha" && -n "$x64_sha" ]]; then
    printf '    if Hardware::CPU.arm?\n'
    printf '      url "https://github.com/%s/releases/download/v#{version}/bematist-v#{version}-%s-arm64"\n' "$repo" "$os_slug"
    printf '      sha256 "%s"\n' "$arm_sha"
    printf '    else\n'
    printf '      url "https://github.com/%s/releases/download/v#{version}/bematist-v#{version}-%s-x64"\n' "$repo" "$os_slug"
    printf '      sha256 "%s"\n' "$x64_sha"
    printf '    end\n'
  elif [[ -n "$arm_sha" ]]; then
    printf '    url "https://github.com/%s/releases/download/v#{version}/bematist-v#{version}-%s-arm64"\n' "$repo" "$os_slug"
    printf '    sha256 "%s"\n' "$arm_sha"
  else
    printf '    url "https://github.com/%s/releases/download/v#{version}/bematist-v#{version}-%s-x64"\n' "$repo" "$os_slug"
    printf '    sha256 "%s"\n' "$x64_sha"
  fi
  printf '  end\n'
}

macos_block="$(emit_os_block macos darwin "$da" "$dx")"
linux_block="$(emit_os_block linux  linux  "$la" "$lx")"

# Write rendered blocks to a temp file; awk reads from the file at the
# @OS_BLOCKS@ injection point. We use a file (not an awk -v variable) because
# BSD awk on macOS rejects embedded newlines in `-v` values.
blocks_file="$(mktemp "${TMPDIR:-/tmp}/bematist-brew-blocks.XXXXXX")"
trap 'rm -f "$blocks_file"' EXIT
{
  if [[ -n "$macos_block" ]]; then
    printf '%s\n' "$macos_block"
    if [[ -n "$linux_block" ]]; then
      printf '\n'
    fi
  fi
  if [[ -n "$linux_block" ]]; then
    printf '%s\n' "$linux_block"
  fi
} > "$blocks_file"

awk -v ver="$version" -v blocks_file="$blocks_file" '
  {
    gsub(/@VERSION@/, ver)
    if ($0 ~ /^@OS_BLOCKS@$/) {
      while ((getline line < blocks_file) > 0) print line
      close(blocks_file)
      next
    }
    print
  }
' "$tmpl"
