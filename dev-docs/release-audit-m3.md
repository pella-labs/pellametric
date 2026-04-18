# M3 · Distro packages + signed release pipeline — audit

> **Source of truth:** CLAUDE.md §Security Rules (distribution) + PRD.md §11.
> **Item:** `dev-docs/m3-gate-followups.md` §6.
> **Date:** 2026-04-17.
> **Scope of THIS PR:** audit + small pipeline extensions (cosign verify step,
> placeholder registry-publish jobs). **No** actual publish to taps / repos /
> AUR / Chocolatey — those are first-real-tag work.

## Requirements (PRD §11.1–11.3 / CLAUDE.md §Security Rules)

| # | Requirement | Status | Where |
|---|-------------|--------|-------|
| 1 | Distro packages PRIMARY — Homebrew, apt/deb, AUR, Chocolatey | 🟡 scaffolded · 0 published | `packaging/{homebrew,deb,aur,choco}/`, `.github/workflows/release.yml#package` |
| 2 | `curl \| sh` FALLBACK, wrapped in `main()` so partial-pipe fails closed | ✅ shipped | `packaging/install.sh` (has `main()`, `set -eu`, cosign opt-in) |
| 3 | Sigstore + cosign signature per release | ✅ shipped | `release.yml#build.steps."Cosign keyless sign"` (produces `.sig` + `.pem`) |
| 4 | cosign **verify** step proves binaries are signed in CI | 🟡 added in this PR | `release.yml#verify` (new job) |
| 5 | SHA-256 in GH Release notes | ✅ shipped | `release.yml#release` writes `manifest.sha256` into `NOTES.md` |
| 6 | SLSA Level 3 attestation via reusable workflow | ✅ shipped | `release.yml#provenance` uses `slsa-framework/slsa-github-generator/.github/workflows/generator_generic_slsa3.yml@v2.0.0` |
| 7 | Agent verifies managed-settings.json signature on session start | ❌ deferred — belongs to A14 / policy-flip track (`apps/collector/src/` not in this PR's scope); wired up in `packages/config/src/signed-config.ts` already | — |
| 8 | Manager dashboard shows per-dev binary SHA-256 + alerts admins | ❌ deferred — Workstream G frontend | — |
| 9 | Egress allowlist `--ingest-only-to <hostname>` with cert pinning | ❌ deferred — collector work | — |
| 10 | CycloneDX SBOM per release (Compliance §12) | ✅ shipped | `release.yml#sbom` via `anchore/sbom-action@v0` |

## Binary build coverage

| Target | Runner | Status |
|---|---|---|
| `linux-x64` | ubuntu-latest | ✅ |
| `linux-arm64` | ubuntu-latest (native bun cross-compile) | ✅ |
| `darwin-x64` | macos-13 | ✅ |
| `darwin-arm64` | macos-14 | ✅ |
| `windows-x64` | windows-latest | ✅ |

`bun build --compile --target=bun-<os>-<arch>` is native cross-compile — no
QEMU needed.

## Per-distro channel status

### Homebrew (PRIMARY, macOS)

- ✅ Formula template `packaging/homebrew/bematist.rb.tmpl` with both CPU
  architectures per OS, `license "Apache-2.0"`, placeholder sha256 digests.
- ✅ Render script `packaging/homebrew/render.sh` substitutes digests at
  release time.
- 🟡 `release.yml#publish-homebrew` job exists but is `if: ${{ false && ... }}`
  pending:
  1. Create `bematist-org/homebrew-tap` repository.
  2. Create `HOMEBREW_TAP_TOKEN` secret (PAT with push to the tap).
  3. Flip the guard to `${{ !contains(needs.meta.outputs.tag, '-') }}`.
- **SHIPPED in this PR:** clearer TODO block above the job; see inline
  comments in `release.yml`.

### Debian / Ubuntu

- ✅ `packaging/deb/control.tmpl` + `build.sh` produce `bematist_<ver>_<arch>.deb`
  for amd64 + arm64 at release time.
- 🟡 **No `apt` repository published.** `.deb` files are attached to the GH
  release; consumers do `curl -L … && dpkg -i`. That's more tap-less than
  `apt install bematist`.
- 🟡 `publish-deb` placeholder job added in this PR (`if: false`). Real impl
  needs: (1) decide repo host (OpenSUSE OBS vs self-host vs freight on S3);
  (2) signing key provisioning; (3) `apt-ftparchive` run; (4) CDN publish.
- **Deferred:** apt-repo host selection + GPG signing key.

### AUR (Arch Linux)

- ✅ `packaging/aur/PKGBUILD.tmpl` for `bematist-bin` source package.
- ✅ Render produces `dist/PKGBUILD` and uploads as release artifact.
- 🟡 **No auto-push to `aur.archlinux.org:bematist-bin.git`.** Per `packaging/README.md` the v0.1.0 plan is hand-push.
- 🟡 `publish-aur` placeholder job added in this PR (`if: false`). Real impl
  needs: (1) SSH key registered with `aur.archlinux.org`; (2) `AUR_SSH_KEY`
  secret; (3) `.SRCINFO` regeneration via `makepkg --printsrcinfo`.
- **Deferred:** AUR SSH key provisioning + `.SRCINFO` generation step.

### Chocolatey (Windows)

- ✅ `packaging/choco/bematist.nuspec.tmpl` + `chocolateyInstall.ps1.tmpl`
  + render.
- 🟡 Pack step + push to community feed not wired.
- 🟡 `publish-choco` placeholder job added in this PR (`if: false`). Real
  impl needs: (1) `CHOCO_API_KEY` secret from the community account;
  (2) `choco pack` on a windows-latest runner; (3) moderation lead time
  (~1 week per new package).
- **Deferred:** community-feed moderation account creation.

## Shipped in THIS PR

1. **`.github/workflows/release.yml` — new `verify` job** that downloads the
   just-signed artifacts and runs `cosign verify-blob` against the known OIDC
   identity. Fails the release if signatures don't validate against the
   expected workflow ref. Gates `release` on `verify` passing.
2. **`.github/workflows/release.yml` — placeholder `publish-deb` /
   `publish-aur` / `publish-choco` jobs** with `if: false` and explicit TODO
   blocks linking to PRD §11 and this audit doc. Follows the existing
   `publish-homebrew` gating pattern so a future PR needs only a single flip
   to enable.
3. **`dev-docs/release-audit-m3.md`** (this file).

## Acceptance vs `m3-gate-followups.md` §6

- [x] Audit document lists every PRD §11 requirement with status.
- [x] Homebrew channel has an end-to-end pipeline (template + render +
      package job + publish job behind a feature flag).
- [x] cosign **signing** already existed; cosign **verify** step added in
      this PR.
- [ ] "A developer can `brew install bematist && bematist install && bematist
      dry-run`" — **still deferred** because it requires the
      `bematist-org/homebrew-tap` repo to exist + one real release tag. This
      PR gets the pipeline green; the orchestrator cuts `v0.1.0` to close.

## Follow-ups (tracked, out of scope here)

- [ ] Create `bematist-org/homebrew-tap` + `HOMEBREW_TAP_TOKEN` secret · flip
      `publish-homebrew.if`.
- [ ] Stand up apt repo (host decision pending) · add GPG signing step.
- [ ] AUR account SSH key + `.SRCINFO` generation.
- [ ] Chocolatey community-feed account + `choco pack`/`choco push`.
- [ ] Hook `bematist doctor` to check installed SHA256 against the release
      manifest (CLAUDE.md: "Manager dashboard shows per-dev binary SHA256"
      — owner-side; the collector-side check is the other half).
- [ ] Bill of Rights /privacy page link to this verify flow so the public
      install instructions mirror the distro-primary rule.
