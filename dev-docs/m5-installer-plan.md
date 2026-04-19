# Bematist — collector installer plan (M5, L3-first)

The cutover the night of 2026-04-18 surfaced a real UX cliff: the `curl | sh` one-liner installs the binary but the shell-only env vars (`BEMATIST_ENDPOINT`, `BEMATIST_TOKEN`) evaporate the moment the installer exits. Users have to `export` them by hand and then `bematist serve` blocks a terminal for their whole session. A 100-dev rollout cannot ship on that baseline.

**Decision (2026-04-19): go straight to L3.** We skip the L1-first / L2-second incremental and ship distro packages as the primary install path. L1 (config persistence) and L2 (OS daemon units) still get built — they're the foundations every distro package's post-install hook depends on. We just don't ship them as standalone milestones.

The earlier L1 → L2 → L3 framing lives at the bottom of this doc for reference if we ever need to bail out and ship incrementally (e.g., if distro moderation stalls).

---

## Scope

At the end of this milestone, a new teammate's install flow is:

```sh
# macOS
brew install bematist-org/tap/bematist
bematist config set endpoint https://ingest-development.up.railway.app
bematist config set token bm_orgslug_keyid_secret
brew services start bematist

# Ubuntu/Debian
curl -fsSL https://bematist.dev/apt/public.gpg | sudo tee /etc/apt/trusted.gpg.d/bematist.gpg
echo 'deb https://bematist.dev/apt stable main' | sudo tee /etc/apt/sources.list.d/bematist.list
sudo apt update && sudo apt install bematist
bematist config set endpoint ...
bematist config set token ...
systemctl --user start bematist

# Arch
yay -S bematist-bin && bematist config set …

# Windows
choco install bematist && bematist config set …
```

The `/welcome` page emits the right one-liner per OS with the token pre-baked. Config persists, the daemon auto-starts on boot, and `bematist status` reports live.

**Effort:** ~1 week wall-clock, mostly provisioning waits (Chocolatey first-upload moderation is the long pole at ~1 week). Active implementation is 2–3 days.

---

## Foundations (must land before any channel flips on)

These were previously "L1" and "L2" — they ship as part of this milestone but are not user-visible shipping events on their own.

### F1 — Config file + `bematist config` subcommand

Every distro package's post-install hook needs a stable place to write the endpoint + token; every post-upgrade hook needs to preserve them. `~/.bematist/config.env` is that place.

- [ ] Edit `apps/collector/src/config.ts` — before reading `process.env.BEMATIST_*`, parse `~/.bematist/config.env` (shell-style `KEY=VALUE` lines, no quoting). `process.env` wins over file. Track the source (`env | file | default`) per key for `doctor` output.
- [ ] Add `bematist config set <key> <value>` / `bematist config get <key>` / `bematist config list` — writes to `~/.bematist/config.env` with `umask 077`, chmod 600. Keys: `endpoint`, `token`, `log-level`, `poll-timeout-ms`, `batch-size`, `ingest-only-to`.
- [ ] `bematist doctor` prints `endpoint: https://… (from file)` or `(from env)` next to each resolved value.
- [ ] `packaging/install.sh` accepts `--endpoint <url>` and `--token <bearer>` flags (and falls through to env). When present, writes `~/.bematist/config.env` atomically (`.tmp` + `rename`). Prints "wrote config — run `bematist start` to launch the background service."
- [ ] Keep `install.sh` working as the non-distro fallback. It's still what `curl | sh` resolves to.

**Tests:**
- Unit: config loader precedence env > file > default; malformed file doesn't crash, logs warn + skips.
- Integration: `tests/installer/install-persists-config.sh` — sets env, runs `install.sh`, asserts `~/.bematist/config.env` has both lines at mode 0600.

### F2 — OS service units + lifecycle subcommands

Distro packages' post-install hooks reference these unit files; the CLI wraps the OS-specific tooling so teammates don't need to know launchctl vs systemctl vs schtasks.

- [ ] `packaging/launchd/dev.bematist.collector.plist.tmpl` — user LaunchAgent, `RunAtLoad=true`, `KeepAlive=true`, `SoftResourceLimits.Core=0` (CLAUDE.md §Security Rules requires no crash dumps). Logs to `~/.bematist/logs/{out,err}.log`.
- [ ] `packaging/systemd/bematist.service.tmpl` — user unit, `Type=simple`, `Restart=on-failure`, `LimitCORE=0`, `EnvironmentFile=%h/.bematist/config.env`, `WantedBy=default.target`.
- [ ] `packaging/windows/bematist.xml.tmpl` + `tools/chocolateyInstall.ps1` — Scheduled Task via `Register-ScheduledTask`, runs at logon, hidden, auto-restart on failure, working dir `%USERPROFILE%\.bematist`.
- [ ] `bematist start` — dispatches to `launchctl bootstrap gui/$(id -u) …` / `systemctl --user enable --now bematist.service` / `Start-ScheduledTask Bematist`. Idempotent.
- [ ] `bematist stop` — mirror.
- [ ] `bematist status` — reads launchd via `launchctl print`, systemd via `systemctl --user is-active`, Windows via `Get-ScheduledTask`. Surfaces: `running | stopped | not installed` + log-tail hint.
- [ ] `bematist logs` — tails `~/.bematist/logs/*.log` (cross-platform; on Windows the Scheduled Task redirects stdout/stderr into those files).

**Tests:**
- macOS CI fixture: install via `install.sh`, assert `launchctl list | grep dev.bematist.collector`.
- Linux CI fixture: same with `systemctl --user is-active bematist`.
- Crash-restart: `kill -9 $(pgrep bematist)`, assert process PID changes within 5s.

### F3 — Render-script resilience

Current render scripts hard-code `darwin-x64` and `exit 1` when the binary is missing. We dropped darwin-x64 in v0.1.x. Fix before any channel flips on.

- [ ] `packaging/homebrew/render.sh` — `continue` rather than `exit 1` when a target binary is absent; emit only the `on_macos` / `on_linux` / arch stanzas present in `$dist`.
- [ ] `packaging/homebrew/bematist.rb.tmpl` — conditional URL blocks driven by the render script, not static.
- [ ] `packaging/aur/render.sh` — confirm it filters to linux-only (AUR doesn't ship darwin binaries anyway). Verify `.SRCINFO` regeneration hook.
- [ ] `packaging/choco/render.sh` — confirm it consumes only `windows-x64`; skip gracefully otherwise.
- [ ] `packaging/deb/build.sh` — already arch-aware; add a sanity check that at least one of `linux-amd64` / `linux-arm64` is present before proceeding.

**Tests:**
- `bash packaging/homebrew/render.sh dist-fixtures/v0.1.0` (with only linux + darwin-arm64) produces a valid formula that `brew audit --new-formula` passes.
- Same for AUR, Chocolatey, deb.

---

## Channel 1 — Homebrew (macOS + Linux)

Priority: **highest** (majority of dev-facing install).

### Prereqs (one-time, outside the repo)

1. **Create** `github.com/pella-labs/homebrew-tap`. Standalone repo; name MUST start with `homebrew-`.
2. **Seed** with:
   - `Formula/bematist.rb` — placeholder; CI will overwrite per release
   - `README.md` — `brew install pella-labs/tap/bematist`
   - `.github/workflows/test.yml` — `brew test-bot` on PRs
3. **Fine-grained PAT** on an account with push to the tap (scope: Contents:read-write on tap only). Store as GH Actions secret `HOMEBREW_TAP_TOKEN` on the main repo.

### Code changes

- [ ] `packaging/homebrew/bematist.rb.tmpl`:
  - `service do … end` block that registers the LaunchAgent from F2. `brew services start bematist` launches it.
  - `caveats do … end` — reminds the user to `bematist config set endpoint/token` before starting, OR to use the one-liner from `/welcome`.
- [ ] `packaging/homebrew/render.sh` — emit SHA256 per binary from `SHA256SUMS.txt` (produced by the existing build job).
- [ ] `.github/workflows/release.yml` `publish-homebrew` job:
  - Change guard from `if: ${{ false && … }}` to `if: ${{ !contains(needs.meta.outputs.tag, '-') }}`.
  - Clone the tap repo with `HOMEBREW_TAP_TOKEN`, overwrite `Formula/bematist.rb`, commit + push.
  - Trigger `brew test-bot` on the resulting PR (the tap's own workflow picks it up).

### Acceptance

- [ ] `brew tap pella-labs/tap && brew install bematist` on a fresh macOS VM.
- [ ] `brew services start bematist` — LaunchAgent loaded, `bematist status` shows running.
- [ ] `brew uninstall bematist` — binary gone, LaunchAgent bootout'd, `~/.bematist/config.env` preserved.
- [ ] `brew upgrade bematist` on new tag — binary replaced, service restarted, config untouched.

---

## Channel 2 — Debian/Ubuntu apt

Priority: **high** (primary Linux channel).

### Prereqs — pick a repo host

| Option | Pros | Cons |
|---|---|---|
| **Cloudsmith** free dev tier | Clean URL, zero infra, signing baked in | Vendor lock-in, paid beyond free tier |
| **Self-host on S3 + CloudFront** (`reprepro`/`aptly`) | Total control, clean `apt.bematist.dev` | AWS infra, GPG rotation, repo sync script |
| **OBS (OpenSUSE Build Service)** | Free, GPG solved | Branding says OpenSUSE in URLs |

**Recommend Cloudsmith** for fastest ship + cleanest URL; migrate to self-host when scale warrants.

### Code

- [ ] Generate RSA 4096 GPG key for package signing. Store private key as GH secret `APT_SIGNING_KEY`. Publish public at `https://bematist.dev/apt/public.gpg` (or Cloudsmith's key URL until `bematist.dev` is hosting static assets).
- [ ] `packaging/deb/build.sh` — already emits `.deb`. Confirm `postinst` script:
  - Installs `/etc/systemd/user/bematist.service` from F2 template.
  - Registers per-user via `systemctl --user daemon-reload` on first `systemctl --user start`.
  - Prints a `loginctl enable-linger` note if `Linger=no` (otherwise the service stops at logout).
- [ ] `.github/workflows/release.yml` `publish-deb` job:
  - Import `APT_SIGNING_KEY` via `gpg --batch --import`.
  - `reprepro --basedir /tmp/apt-repo includedeb stable dist/bematist_*_amd64.deb dist/bematist_*_arm64.deb`.
  - `gpg --detach-sign --armor Release > Release.gpg` + `gpg --clearsign Release > InRelease`.
  - Sync to Cloudsmith via `cloudsmith push deb pella-labs/bematist/any-distro/any-version dist/bematist_*.deb`.
  - Flip guard from `if: ${{ false && … }}` to non-prerelease check.

### User-facing install

```sh
curl -fsSL https://dl.cloudsmith.io/public/pella-labs/bematist/gpg.key | sudo gpg --dearmor -o /etc/apt/trusted.gpg.d/bematist.gpg
echo 'deb https://dl.cloudsmith.io/public/pella-labs/bematist/deb/any-distro any-version main' | sudo tee /etc/apt/sources.list.d/bematist.list
sudo apt update && sudo apt install bematist
```

Once `bematist.dev` is serving static assets we swap the `dl.cloudsmith.io` URL for our own redirect.

### Acceptance

- [ ] `apt install bematist` on fresh Ubuntu 22.04 + Debian 12 containers.
- [ ] `systemctl --user status bematist` running after install + `bematist config set`.
- [ ] `apt upgrade bematist` picks up a new tag.
- [ ] `apt remove --purge bematist` — binary gone, systemd unit disabled, config preserved.

---

## Channel 3 — AUR (Arch)

Priority: **medium** (small audience, high-signal).

### Prereqs

1. AUR account at `aur.archlinux.org/register`.
2. SSH key added to AUR account.
3. Reserve `bematist-bin` (AUR convention for binary-distributed).
4. Store SSH private key as GH secret `AUR_SSH_KEY`.

### Code

- [ ] `packaging/aur/PKGBUILD.tmpl` — confirm `post_install()` hook registers the systemd user unit from F2. `source` array includes the linux tarballs from the GH release.
- [ ] `packaging/aur/render.sh` — generate `.SRCINFO` via `makepkg --printsrcinfo` (CI needs `archlinux:latest` container step).
- [ ] `.github/workflows/release.yml` `publish-aur` job:
  - `ssh-agent bash -c 'echo "$AUR_SSH_KEY" | ssh-add -'`
  - `git clone ssh://aur@aur.archlinux.org/bematist-bin.git aur-pkg`
  - Overwrite `PKGBUILD` + `.SRCINFO`, commit with `bematist $TAG`, push.
  - Flip guard.

### Acceptance

- [ ] `yay -S bematist-bin` on fresh Arch container.
- [ ] Systemd unit registered + started via `post_install()`.
- [ ] `yay -Rns bematist-bin` — clean uninstall.

---

## Channel 4 — Chocolatey (Windows)

Priority: **medium**. David is on Windows; moderation is the long pole.

### Prereqs

1. Register Chocolatey community account.
2. First-package moderation: **~1 week wait** for initial `bematist` approval. Subsequent tags auto-approved.
3. Store `CHOCO_API_KEY` as GH secret.

### Code

- [ ] `packaging/choco/chocolateyInstall.ps1.tmpl` — `Register-ScheduledTask` from F2 template; runs at logon, hidden, auto-restart on failure.
- [ ] `packaging/choco/render.sh` — emit `bematist.nuspec` with the release version + checksums.
- [ ] `.github/workflows/release.yml` `publish-choco` job:
  - `choco pack bematist.nuspec`
  - `choco push bematist.$version.nupkg --api-key $CHOCO_API_KEY --source https://push.chocolatey.org/`
  - Flip guard.

### Acceptance

- [ ] `choco install bematist` on Windows 11.
- [ ] `bematist status` — scheduled task registered, process running.
- [ ] `choco uninstall bematist` — clean.

---

## Rollout order (1-week wall-clock, 2–3 dev-days active)

Provisioning and active work parallelize. Start the long-lead external accounts on Day 1, code against them while they propagate.

### Day 1 (Monday) — start provisioning, ship foundations

**External (kick off, wait in background):**
- Register Chocolatey account + submit first-package stub (starts the ~7-day moderation clock).
- Register AUR account, add SSH key, reserve `bematist-bin`.
- Create `pella-labs/homebrew-tap` repo, seed placeholder formula.
- Sign up for Cloudsmith, create `pella-labs/bematist` apt repo.
- Generate GPG signing key, upload public to Cloudsmith, store private as GH secret.

**Code (active):**
- F1 — config loader + `bematist config` subcommand + `install.sh` flags. Tests.
- F3 — render-script resilience. Run each `render.sh` against v0.1.0 dist fixtures; all four pass.

### Day 2 (Tuesday) — foundations done, Homebrew flips

- F2 — service units + lifecycle subcommands (`start`/`stop`/`status`/`logs`). Tests on macOS + Linux.
- Channel 1 — render formula, flip `publish-homebrew` guard, tag `v0.1.1`, verify tap auto-updates, run `brew install` acceptance on a fresh macOS VM.

### Day 3 (Wednesday) — apt + AUR

- Channel 2 — post-install script, release workflow wire-up, tag `v0.1.2` (or force-push to v0.1.1 tag if clean), verify `apt install` on fresh Ubuntu 22.04 + Debian 12.
- Channel 3 — `.SRCINFO` generation, release workflow wire-up, verify `yay -S bematist-bin` on fresh Arch.

### Day 4 (Thursday) — Windows

- Channel 4 — Scheduled Task install script, release workflow wire-up. If Chocolatey moderation is still pending, push the package to the queue and document the manual install path on `/welcome` as a bridge.

### Day 5 (Friday) — `/welcome` page + docs

- Update `/welcome` page: OS detection + per-OS install command. Homebrew, apt, AUR are primary; `curl | sh` is fallback; Chocolatey shown as "pending moderation — use direct download" until approved.
- Update `dev-docs/m4-team-onboarding.md`.
- Revoke the admin-role invite + mint an `ic` one (queued follow-up from handoff).
- Re-run the 2026-04-18 tonight-flow end-to-end with Sandesh + Walid on the new paths.

### Rolling (next 1–3 days) — Chocolatey moderation clears

- When Chocolatey approves, flip `publish-choco` guard, tag next release, update `/welcome` to promote `choco install bematist` from fallback to primary.

---

## Fallback plan — if Chocolatey moderation stalls past a week

Windows users stay on the direct `install.ps1` download path documented in `/welcome`. The `publish-choco` job stays gated; every other channel ships as planned. This is the only provisioning dependency that can legitimately block a channel; it's also the lowest-volume audience, so it's safe to detach.

---

## Open questions for the first install-day

- **How do we revoke a teammate's collector remotely?** Ingest-key revoke path already exists — admin clicks Revoke in `/admin/ingest-keys`, the bearer 401s within the 60s LRU window. Collector keeps retrying; admin should mint + send a new one.
- **Dual-machine setup (laptop + work desktop)?** Two options:
  1. Same bearer on both machines. Works today. Events look like one engineer from both.
  2. Mint separate keys per machine, tag them differently. Per-device rollup is a future dashboard feature — skip until asked.
- **Offline-first behavior?** Collector buffers in egress journal if ingest unreachable, retries on next poll. Fine.
- **Air-gapped enterprise installs?** Out of scope for M5. Phase 3+ concern per CLAUDE.md.
- **Where do `bematist config set` changes get picked up by a running daemon?** Daemon re-reads `~/.bematist/config.env` on SIGHUP. `bematist config set` sends SIGHUP to the running PID after writing. If no daemon running, no-op + note.

---

## Where to start tomorrow

1. Read `m5-handoff.md` — resume-from-clean-context.
2. Run `bematist doctor` in a fresh terminal to confirm the L0 pain baseline.
3. **Fire off external provisioning (Day 1 "External" list) first** — Chocolatey moderation is 7 days and everything else takes minutes.
4. Start on **F1** (config loader + `bematist config` subcommand). Everything downstream depends on it.
5. Keep release tags flowing — `v0.1.1`, `v0.1.2`, etc. Each channel flip gets its own tag so bisect stays useful if a channel breaks.

---

## Appendix — incremental-shipping fallback (L1 → L2 → L3)

Kept for reference. If distro moderation stalls across *multiple* channels or Cloudsmith + tap provisioning drags past Day 2, bail out to the previous plan:

1. **Week 1** — ship F1 standalone. Welcome-page one-liner becomes copy-paste self-contained via `curl | sh -- --endpoint … --token …`. `curl | sh` stays primary.
2. **Week 2** — ship F2 standalone. One-liner ends with "Bematist is now running in background."
3. **Week 3+** — resume L3 as above.

This is strictly the escape hatch. The `lets go for L3 from the getgo` decision stands unless provisioning blocks us twice in a week.
