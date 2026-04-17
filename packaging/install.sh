#!/bin/sh
# Bematist installer — FALLBACK path for `curl … | sh`.
#
# Preferred install is `gh release download` + `cosign verify-blob`. This
# installer is the quick-win for developers without gh/cosign; it still
# verifies the SHA-256 from the release manifest (signed by the same GH OIDC
# identity as the binaries themselves).
#
# Wrapped in `main()` so a truncated pipe never executes a partial script
# (CLAUDE.md §Security Rules). Exits non-zero on any failure.
#
# Usage:
#   curl -fsSL https://bematist.dev/install.sh | sh
#   curl -fsSL https://bematist.dev/install.sh | sh -s -- --version v0.1.0
#   curl -fsSL https://bematist.dev/install.sh | sh -s -- --prefix "$HOME/.local"
#   curl -fsSL https://bematist.dev/install.sh | sh -s -- --verify-cosign

set -eu

REPO_DEFAULT="bematist-org/bematist"
PREFIX_DEFAULT="/usr/local"

main() {
  repo="${BEMATIST_REPO:-$REPO_DEFAULT}"
  prefix="${BEMATIST_PREFIX:-$PREFIX_DEFAULT}"
  version=""
  verify_cosign=0

  while [ $# -gt 0 ]; do
    case "$1" in
      --version) version="$2"; shift 2 ;;
      --version=*) version="${1#*=}"; shift ;;
      --prefix) prefix="$2"; shift 2 ;;
      --prefix=*) prefix="${1#*=}"; shift ;;
      --repo) repo="$2"; shift 2 ;;
      --repo=*) repo="${1#*=}"; shift ;;
      --verify-cosign) verify_cosign=1; shift ;;
      --help|-h) usage; return 0 ;;
      *) err "unknown flag: $1"; usage; return 2 ;;
    esac
  done

  require curl
  require uname
  require install
  shasum_cmd=$(detect_shasum)

  os=$(detect_os)
  arch=$(detect_arch)
  tag=$(resolve_tag "$repo" "$version")
  say "Bematist $tag · target $os-$arch · prefix $prefix"

  tmp=$(mktemp -d 2>/dev/null || mktemp -d -t bematist)
  trap 'rm -rf "$tmp"' EXIT INT TERM

  ext=""
  [ "$os" = "windows" ] && ext=".exe"
  binary="bematist-${tag}-${os}-${arch}${ext}"
  base="https://github.com/${repo}/releases/download/${tag}"

  say "downloading $binary"
  curl -fsSL --retry 3 --retry-delay 2 -o "$tmp/$binary" "$base/$binary"

  say "downloading SHA-256 manifest"
  curl -fsSL --retry 3 --retry-delay 2 -o "$tmp/manifest.sha256" "$base/manifest.sha256"

  expected=$(awk -v f="$binary" '$2 == f { print $1 }' "$tmp/manifest.sha256")
  if [ -z "$expected" ]; then
    err "no SHA-256 for $binary in release manifest"; return 1
  fi

  say "verifying SHA-256"
  actual=$($shasum_cmd "$tmp/$binary" | awk '{ print $1 }')
  if [ "$actual" != "$expected" ]; then
    err "SHA-256 mismatch (want $expected, got $actual)"; return 1
  fi

  if [ "$verify_cosign" -eq 1 ]; then
    require cosign
    say "downloading cosign signature + certificate"
    curl -fsSL --retry 3 --retry-delay 2 -o "$tmp/$binary.sig" "$base/$binary.sig"
    curl -fsSL --retry 3 --retry-delay 2 -o "$tmp/$binary.pem" "$base/$binary.pem"
    cosign verify-blob \
      --certificate-identity-regexp "^https://github.com/${repo}/\\.github/workflows/release\\.yml@refs/tags/v" \
      --certificate-oidc-issuer https://token.actions.githubusercontent.com \
      --certificate "$tmp/$binary.pem" \
      --signature "$tmp/$binary.sig" \
      "$tmp/$binary"
    say "cosign verification passed"
  else
    say "skipping cosign verification (pass --verify-cosign for keyless sig check)"
  fi

  target="$prefix/bin"
  if [ ! -d "$target" ] && ! mkdir -p "$target" 2>/dev/null; then
    err "can't create $target — re-run with --prefix \"\$HOME/.local\" or sudo"
    return 1
  fi

  if [ -w "$target" ]; then
    install -m 0755 "$tmp/$binary" "$target/bematist"
  else
    say "writing to $target requires sudo"
    sudo install -m 0755 "$tmp/$binary" "$target/bematist"
  fi

  say "installed: $target/bematist"
  say "next: run \`bematist doctor\` — and see https://bematist.dev/docs for setup"
}

usage() {
  cat <<'EOF'
bematist installer

Options:
  --version <vX.Y.Z>      install a specific tag (default: latest)
  --prefix <path>         install prefix (default: /usr/local)
  --repo <owner/name>     override GH release source
  --verify-cosign         also verify the keyless Sigstore signature
  -h, --help              show this help

Environment:
  BEMATIST_REPO           same as --repo
  BEMATIST_PREFIX         same as --prefix

Recommended (distro packages are the PRIMARY path):
  brew install bematist-org/tap/bematist        # macOS
  dpkg -i bematist_<ver>_<arch>.deb             # Debian/Ubuntu
  yay -S bematist-bin                           # Arch
  choco install bematist                        # Windows
EOF
}

say() { printf '  bematist: %s\n' "$*"; }
err() { printf '  bematist: %s\n' "$*" >&2; }

require() {
  command -v "$1" >/dev/null 2>&1 || { err "missing required tool: $1"; exit 1; }
}

detect_shasum() {
  if command -v sha256sum >/dev/null 2>&1; then echo "sha256sum"; return; fi
  if command -v shasum >/dev/null 2>&1; then echo "shasum -a 256"; return; fi
  err "neither sha256sum nor shasum found"; exit 1
}

detect_os() {
  case "$(uname -s)" in
    Linux)  echo linux ;;
    Darwin) echo darwin ;;
    MINGW*|MSYS*|CYGWIN*) echo windows ;;
    *) err "unsupported OS: $(uname -s)"; exit 1 ;;
  esac
}

detect_arch() {
  case "$(uname -m)" in
    x86_64|amd64) echo x64 ;;
    aarch64|arm64) echo arm64 ;;
    *) err "unsupported arch: $(uname -m)"; exit 1 ;;
  esac
}

resolve_tag() {
  _repo="$1"; _ver="$2"
  if [ -n "$_ver" ]; then printf '%s' "$_ver"; return; fi
  # GH API latest-release redirect is stable w/o auth for public repos.
  curl -fsSL "https://api.github.com/repos/${_repo}/releases/latest" \
    | awk -F'"' '/"tag_name"/ { print $4; exit }'
}

main "$@"
