# packaging/

Release-time artifacts used by `.github/workflows/release.yml`. Every release
produces:

- Binaries `bematist-v<ver>-{linux,darwin,windows}-{x64,arm64}` via
  `bun build --compile --target=bun-<os>-<arch>`
- `bematist-v<ver>-<os>-<arch>.sha256` per binary
- `bematist-v<ver>-<os>-<arch>.sig` + `.pem` from **cosign keyless signing**
  (GH Actions OIDC identity → Sigstore Fulcio)
- `manifest.sha256` — flat digest list for the whole release
- `bematist-<tag>.intoto.jsonl` — **SLSA Level 3** provenance via
  `slsa-framework/slsa-github-generator`

## Install paths (security rules)

Per `CLAUDE.md` §Security Rules: **distro packages are the PRIMARY install
path.** `curl | sh` is the fallback, wrapped in `main()` so a truncated pipe
never executes a partial script.

Default install path:

```sh
gh release download v0.1.0 \
  --repo bematist-org/bematist \
  --pattern 'bematist-v0.1.0-darwin-arm64*'

cosign verify-blob \
  --certificate-identity-regexp '^https://github.com/bematist-org/bematist/\.github/workflows/release\.yml@refs/tags/v' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  --certificate bematist-v0.1.0-darwin-arm64.pem \
  --signature   bematist-v0.1.0-darwin-arm64.sig \
  bematist-v0.1.0-darwin-arm64

install -m 0755 bematist-v0.1.0-darwin-arm64 /usr/local/bin/bematist
```

Distro packages:

| OS | Command |
|---|---|
| macOS | `brew install bematist-org/tap/bematist` |
| Debian/Ubuntu | `sudo dpkg -i bematist_<ver>_<arch>.deb` |
| Arch | `yay -S bematist-bin` |
| Windows | `choco install bematist` |

Fallback:

```sh
curl -fsSL https://bematist.dev/install.sh | sh -s -- --verify-cosign
```

## Layout

```
packaging/
  install.sh              # curl-pipe-safe installer (fallback)
  homebrew/
    bematist.rb.tmpl      # formula with @VERSION@ / @SHA256_*@ placeholders
    render.sh             # substitute placeholders → stdout
  deb/
    control.tmpl          # DEBIAN/control with @VERSION@ / @ARCH@
    build.sh              # dpkg-deb build wrapper
  aur/
    PKGBUILD.tmpl         # AUR bin-package template
    render.sh
  choco/
    bematist.nuspec.tmpl  # Chocolatey package manifest
    chocolateyInstall.ps1.tmpl
    render.sh
```

All `render.sh` / `build.sh` scripts are POSIX-sh or bash and read from a
`$dist` dir containing the release binaries. They are invoked by the
`package` job in `.github/workflows/release.yml`.

## First-release fill-ins

Before cutting `v0.1.0`, fill in the TODOs marked in
`.github/workflows/release.yml`:

- `HOMEBREW_TAP_TOKEN` secret → PAT with push to `bematist-org/homebrew-tap`
- Flip `publish-homebrew.if: ${{ false && ... }}` → `${{ !contains(...) }}`
- `CHOCO_API_KEY` secret (when the Chocolatey push job lands; currently nuspec
  artifact is published but not auto-pushed)
- `AUR_SSH_KEY` secret for `ssh://aur@aur.archlinux.org/bematist-bin.git`
  (AUR push job lands in a follow-up PR — for v0.1.0 we hand-push)
