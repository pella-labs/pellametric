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
#
# Persist-config variant — the welcome-page one-liner feeds this:
#   curl -fsSL .../install.sh | sh -s -- \
#     --endpoint https://ingest.example.test --token bm_orgslug_keyid_secret
#
# `--config-only` skips the binary download and writes config.env only; used
# by the installer integration tests and by re-runs that just want to update
# the endpoint/token on an already-installed machine.

set -eu

REPO_DEFAULT="pella-labs/bematist"
PREFIX_DEFAULT="/usr/local"

main() {
  repo="${BEMATIST_REPO:-$REPO_DEFAULT}"
  prefix="${BEMATIST_PREFIX:-$PREFIX_DEFAULT}"
  version=""
  verify_cosign=0
  endpoint="${BEMATIST_ENDPOINT:-}"
  token="${BEMATIST_TOKEN:-}"
  config_only=0

  while [ $# -gt 0 ]; do
    case "$1" in
      --version) version="$2"; shift 2 ;;
      --version=*) version="${1#*=}"; shift ;;
      --prefix) prefix="$2"; shift 2 ;;
      --prefix=*) prefix="${1#*=}"; shift ;;
      --repo) repo="$2"; shift 2 ;;
      --repo=*) repo="${1#*=}"; shift ;;
      --endpoint) endpoint="$2"; shift 2 ;;
      --endpoint=*) endpoint="${1#*=}"; shift ;;
      --token) token="$2"; shift 2 ;;
      --token=*) token="${1#*=}"; shift ;;
      --verify-cosign) verify_cosign=1; shift ;;
      --config-only) config_only=1; shift ;;
      --help|-h) usage; return 0 ;;
      *) err "unknown flag: $1"; usage; return 2 ;;
    esac
  done

  if [ -n "$endpoint" ] || [ -n "$token" ]; then
    write_config "$endpoint" "$token"
  fi

  if [ "$config_only" -eq 1 ]; then
    if [ -z "$endpoint" ] && [ -z "$token" ]; then
      err "--config-only requires --endpoint and/or --token"
      return 2
    fi
    say "config-only mode — skipping binary download."
    return 0
  fi

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
  if [ -n "$endpoint" ] || [ -n "$token" ]; then
    say "next: run \`bematist start\` to launch the background service."
  else
    say "next: \`bematist config set endpoint <url>\` + \`bematist config set token <bearer>\` + \`bematist start\`."
  fi
}

# Persist config to ~/.bematist/config.env with mode 0600 (token is a bearer
# secret, CLAUDE.md §Security Rules). Atomic via tmp-file + rename so a
# truncated write never lands on disk.
write_config() {
  _endpoint="$1"
  _token="$2"
  # Respect BEMATIST_DATA_DIR override for tests; fall back to $HOME/.bematist.
  _dir="${BEMATIST_DATA_DIR:-$HOME/.bematist}"
  _path="${BEMATIST_CONFIG_ENV_PATH:-$_dir/config.env}"

  # ensure parent dir, private mode. 0700 matches what `bematist config set`
  # uses — collector state (egress journal, policy cache) is not world-readable.
  (umask 077; mkdir -p "$_dir")

  # Preserve prior keys we aren't overwriting — so `install.sh --endpoint X`
  # doesn't wipe out a pre-existing token and vice versa.
  _new=""
  if [ -f "$_path" ]; then
    _new=$(awk -v ep="$_endpoint" -v tk="$_token" '
      /^BEMATIST_ENDPOINT=/ { if (ep != "") next; else print; next }
      /^BEMATIST_TOKEN=/    { if (tk != "") next; else print; next }
      { print }
    ' "$_path")
  else
    _new="# bematist collector config — written by install.sh.
# See dev-docs/m5-installer-plan.md. Safe to hand-edit; preserve KEY=VALUE form."
  fi
  if [ -n "$_endpoint" ]; then
    _new="$_new
BEMATIST_ENDPOINT=$_endpoint"
  fi
  if [ -n "$_token" ]; then
    _new="$_new
BEMATIST_TOKEN=$_token"
  fi

  _tmp="$_path.tmp.$$.$(date +%s)"
  (
    umask 077
    printf '%s\n' "$_new" > "$_tmp"
  )
  chmod 600 "$_tmp"
  mv "$_tmp" "$_path"
  say "wrote config to $_path"
}

usage() {
  cat <<'EOF'
bematist installer

Options:
  --version <vX.Y.Z>      install a specific tag (default: latest)
  --prefix <path>         install prefix (default: /usr/local)
  --repo <owner/name>     override GH release source
  --endpoint <url>        persist ingest endpoint to ~/.bematist/config.env
  --token <bearer>        persist ingest token to ~/.bematist/config.env (0600)
  --config-only           write config.env only, skip binary download
  --verify-cosign         also verify the keyless Sigstore signature
  -h, --help              show this help

Environment:
  BEMATIST_REPO           same as --repo
  BEMATIST_PREFIX         same as --prefix
  BEMATIST_ENDPOINT       same as --endpoint
  BEMATIST_TOKEN          same as --token

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
