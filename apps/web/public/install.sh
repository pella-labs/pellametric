#!/bin/sh
# pella-metrics collector — installer (macOS + Linux).
#
# Wrapped in main() so a truncated pipe (slow network, aborted curl)
# can't execute a partial script. Exits non-zero on any failure.
#
# Usage:
#   curl -fsSL https://pellametric.com/install.sh | sh -s -- --token pm_xxx
#
# Flags:
#   --token <pm_…>    API token (required; can also come from $PELLA_TOKEN)
#   --url <url>       Ingest backend override (default: baked-in production URL)
#   --prefix <dir>    Install prefix (default: /usr/local, falls back to ~/.local)
#   --version <tag>   Specific release tag (default: latest)
#   --repo <owner/name>  GitHub repo (default: pella-labs/pellametric)
#   --no-start        Write config + install binary but don't auto-start the service
#
# Exits 0 when the daemon is installed and running.

set -eu

REPO_DEFAULT="pella-labs/pellametric"
PREFIX_DEFAULT="/usr/local"

say() { printf 'pella-install: %s\n' "$*"; }
err() { printf 'pella-install: %s\n' "$*" >&2; }

require() {
  if ! command -v "$1" >/dev/null 2>&1; then
    err "missing required command: $1"
    exit 1
  fi
}

detect_shasum() {
  if command -v shasum >/dev/null 2>&1; then echo "shasum -a 256"
  elif command -v sha256sum >/dev/null 2>&1; then echo "sha256sum"
  else err "need either shasum or sha256sum"; exit 1
  fi
}

detect_os() {
  case "$(uname -s)" in
    Darwin) echo darwin ;;
    Linux)  echo linux ;;
    *) err "unsupported OS: $(uname -s)"; exit 1 ;;
  esac
}

detect_arch() {
  case "$(uname -m)" in
    arm64|aarch64) echo arm64 ;;
    x86_64|amd64)  echo x64 ;;
    *) err "unsupported arch: $(uname -m)"; exit 1 ;;
  esac
}

resolve_tag() {
  repo="$1"
  version="$2"
  if [ -n "$version" ]; then echo "$version"; return; fi
  # Follow the redirect from /releases/latest to learn the tag without
  # needing jq or a GitHub token. The final URL ends in
  # .../releases/tag/vX.Y.Z.
  loc=$(curl -fsSLI -o /dev/null -w '%{url_effective}' \
        "https://github.com/${repo}/releases/latest")
  tag="${loc##*/}"
  if [ -z "$tag" ] || [ "$tag" = "releases" ]; then
    err "could not resolve latest release tag for ${repo}"
    exit 1
  fi
  echo "$tag"
}

choose_prefix() {
  prefix="$1"
  # Write to $prefix/bin if we can; otherwise fall back to ~/.local/bin.
  bindir="${prefix}/bin"
  if [ -w "$bindir" ] 2>/dev/null || [ "$(id -u)" = "0" ]; then
    echo "$bindir"; return
  fi
  # Try sudo-less /usr/local/bin via `install`; else user-local.
  if [ "$prefix" = "/usr/local" ] && [ ! -w "$bindir" ]; then
    echo "$HOME/.local/bin"; return
  fi
  echo "$bindir"
}

main() {
  repo="${PELLA_REPO:-$REPO_DEFAULT}"
  prefix="${PELLA_PREFIX:-$PREFIX_DEFAULT}"
  version=""
  token="${PELLA_TOKEN:-}"
  url="${PELLA_URL:-}"
  no_start=0

  while [ $# -gt 0 ]; do
    case "$1" in
      --token) token="$2"; shift 2 ;;
      --token=*) token="${1#*=}"; shift ;;
      --url) url="$2"; shift 2 ;;
      --url=*) url="${1#*=}"; shift ;;
      --prefix) prefix="$2"; shift 2 ;;
      --prefix=*) prefix="${1#*=}"; shift ;;
      --version) version="$2"; shift 2 ;;
      --version=*) version="${1#*=}"; shift ;;
      --repo) repo="$2"; shift 2 ;;
      --repo=*) repo="${1#*=}"; shift ;;
      --no-start) no_start=1; shift ;;
      -h|--help)
        sed -n '2,/^$/p' "$0" 2>/dev/null || true
        exit 0
        ;;
      *)
        err "unknown flag: $1"
        exit 2
        ;;
    esac
  done

  if [ -z "$token" ]; then
    err "--token is required (or set \$PELLA_TOKEN)."
    err "get one at https://pellametric.com/setup/collector"
    exit 2
  fi

  require curl
  require uname
  require mktemp
  shasum_cmd=$(detect_shasum)

  os=$(detect_os)
  arch=$(detect_arch)
  asset="pella-${os}-${arch}"
  # $PELLA_INSTALL_BASE (escape hatch) lets staging mirrors and local
  # smoke tests serve binaries from somewhere other than
  # github.com/<repo>/releases/download/<tag>/. When set, the tag lookup
  # is skipped entirely.
  if [ -n "${PELLA_INSTALL_BASE:-}" ]; then
    base="${PELLA_INSTALL_BASE%/}"
    tag="local"
  else
    tag=$(resolve_tag "$repo" "$version")
    base="https://github.com/${repo}/releases/download/${tag}"
  fi
  say "installing ${tag} · target ${os}-${arch}"

  tmp=$(mktemp -d 2>/dev/null || mktemp -d -t pella-install)
  trap 'rm -rf "$tmp"' EXIT INT TERM
  say "downloading ${asset}..."
  curl -fsSL -o "${tmp}/${asset}" "${base}/${asset}" || {
    err "download failed: ${base}/${asset}"
    exit 1
  }
  say "downloading SHA256SUMS..."
  curl -fsSL -o "${tmp}/SHA256SUMS" "${base}/SHA256SUMS" || {
    err "download failed: ${base}/SHA256SUMS"
    exit 1
  }

  expected=$(awk -v a="$asset" '$2==a || $2=="*"a {print $1}' "${tmp}/SHA256SUMS")
  if [ -z "$expected" ]; then
    err "${asset} not listed in SHA256SUMS"
    exit 1
  fi
  actual=$($shasum_cmd "${tmp}/${asset}" | awk '{print $1}')
  if [ "$actual" != "$expected" ]; then
    err "sha256 mismatch: got ${actual}, expected ${expected}"
    exit 1
  fi
  say "sha256 verified"

  bindir=$(choose_prefix "$prefix")
  mkdir -p "$bindir"
  dest="${bindir}/pella"

  chmod +x "${tmp}/${asset}"
  if [ "$os" = "darwin" ]; then
    # Gatekeeper adds com.apple.quarantine on files curl'd into $TMPDIR
    # — stripping it here means the binary launches without the "cannot
    # verify developer" prompt on first run. Ad-hoc codesign isn't
    # enough for Gatekeeper; removing the quarantine attr is.
    xattr -d com.apple.quarantine "${tmp}/${asset}" 2>/dev/null || true
  fi

  # If an older pella is running under a service manager, replacing the
  # binary under it is safer after a stop.
  if [ -x "$dest" ]; then
    "$dest" stop >/dev/null 2>&1 || true
  fi
  mv "${tmp}/${asset}" "$dest"
  say "installed ${dest}"

  # Hand off to `pella login` for token write + service start.
  login_args="login --token ${token}"
  [ -n "$url" ] && login_args="${login_args} --url ${url}"
  [ "$no_start" = "1" ] && login_args="${login_args} --no-start"
  # shellcheck disable=SC2086
  "$dest" $login_args

  if ! echo "$PATH" | tr ':' '\n' | grep -qx "$bindir"; then
    say "note: ${bindir} is not on your \$PATH — add it, or invoke pella by full path."
  fi
  say "done."
}

main "$@"
