# Bematist — collector installer plan (M5)

The cutover the night of 2026-04-18 surfaced a real UX cliff: the `curl | sh` one-liner installs the binary but the shell-only env vars (`BEMATIST_ENDPOINT`, `BEMATIST_TOKEN`) evaporate the moment the installer exits. Users have to `export` them by hand and then `bematist serve` blocks a terminal for their whole session. A 100-dev rollout cannot ship on that baseline.

This plan breaks the fix into three levels. Each stands on its own — ship L1 first, then L2, then L3. L3 is the "real" experience; L1+L2 are the bridge.

---

## Level 1 — Persist config + fall through to file

**Goal:** a user pastes the welcome-page one-liner, hits enter, and `bematist serve` "just works" without any shell-export ritual.

**Effort:** ~45 min.

### Contract

- `install.sh` accepts `BEMATIST_ENDPOINT` and `BEMATIST_TOKEN` from env OR `--endpoint=` / `--token=` flags.
- When set, `install.sh` writes them to `~/.bematist/config.env` (mode 0600) in shell-exportable form:
  ```
  BEMATIST_ENDPOINT=https://ingest-development.up.railway.app
  BEMATIST_TOKEN=bm_orgslug_keyid_secret
  ```
- Collector reads `~/.bematist/config.env` at startup if the corresponding env vars aren't already set. Env wins over file (so `BEMATIST_TOKEN=... bematist serve` still overrides).
- `bematist doctor` prints the resolved config source next to each value: `endpoint: https://... (from ~/.bematist/config.env)` or `(from env)`.

### Tasks

- [ ] Edit `packaging/install.sh`:
  - Accept `--endpoint <url>` and `--token <bearer>` args (after the existing `--version`, `--prefix`, etc.)
  - Fall through to `$BEMATIST_ENDPOINT` / `$BEMATIST_TOKEN` env if flags unset.
  - When either is present, write `~/.bematist/config.env` with both (+ `umask 077` before writing; chmod 600 after).
  - Print a clear message: "wrote config to ~/.bematist/config.env — run `bematist serve` to start."

- [ ] Edit collector config loader (`apps/collector/src/config.ts` — wherever `BEMATIST_ENDPOINT` is first read):
  - Before reading `process.env.BEMATIST_*`, parse `~/.bematist/config.env` if it exists.
  - Merge with `process.env` as the higher precedence.
  - Expose source tracking for `doctor` to surface.

- [ ] Update `bematist doctor` output to annotate `(from env|file|default)` per value.

- [ ] Update `/welcome` page's install one-liner to drop the `export` hint — the command becomes self-contained:
  ```
  curl -fsSL https://github.com/pella-labs/bematist/releases/latest/download/install.sh \
    | sh -s -- --endpoint https://ingest-development.up.railway.app --token bm_...
  ```
- [ ] Update `dev-docs/m4-team-onboarding.md` to match.

- [ ] Tests:
  - Unit test on the collector's config loader: env > file > default precedence.
  - Integration `bash tests/installer/install-persists-config.sh` fixture that sets `BEMATIST_ENDPOINT`, runs `install.sh`, asserts `~/.bematist/config.env` has both lines with mode 0600.

### Not in scope for L1
- Running in the background. User still starts `bematist serve` manually and leaves a tab open.
- Startup on boot.

---

## Level 2 — Background daemon via OS init system

**Goal:** after L1's one-liner completes, the collector is **already running in the background** and auto-restarts on reboot. User never touches `bematist serve` again.

**Effort:** ~2 hr.

### macOS (launchd)

- [ ] `packaging/launchd/dev.bematist.collector.plist` — user agent (LaunchAgent, not LaunchDaemon — runs at login).
  ```xml
  <plist>
    <dict>
      <key>Label</key>              <string>dev.bematist.collector</string>
      <key>ProgramArguments</key>   <array>
        <string>/usr/local/bin/bematist</string>
        <string>serve</string>
      </array>
      <key>KeepAlive</key>          <true/>
      <key>RunAtLoad</key>          <true/>
      <key>StandardOutPath</key>    <string>~/.bematist/logs/out.log</string>
      <key>StandardErrorPath</key>  <string>~/.bematist/logs/err.log</string>
      <key>EnvironmentVariables</key>
      <dict>
        <key>PATH</key>             <string>/usr/local/bin:/usr/bin:/bin</string>
      </dict>
      <!-- crash dumps forbidden per CLAUDE.md §Security Rules -->
      <key>SoftResourceLimits</key>
      <dict>
        <key>Core</key>              <integer>0</integer>
      </dict>
    </dict>
  </plist>
  ```
- [ ] `install.sh` (when `$(uname) = Darwin`):
  1. Renders the plist into `~/Library/LaunchAgents/dev.bematist.collector.plist` with envsubst-style substitution of the resolved HOME path.
  2. `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/dev.bematist.collector.plist`
  3. `launchctl kickstart -k gui/$(id -u)/dev.bematist.collector`
- [ ] `bematist status` reads launchd via `launchctl print gui/$(id -u)/dev.bematist.collector` and surfaces: `running | not running | never loaded`.

### Linux (systemd user units)

- [ ] `packaging/systemd/bematist.service` — user unit under `~/.config/systemd/user/`.
  ```ini
  [Unit]
  Description=Bematist collector
  After=network-online.target
  Wants=network-online.target

  [Service]
  Type=simple
  ExecStart=/usr/local/bin/bematist serve
  Restart=on-failure
  RestartSec=5
  LimitCORE=0
  # Env comes from ~/.bematist/config.env
  EnvironmentFile=%h/.bematist/config.env

  [Install]
  WantedBy=default.target
  ```
- [ ] `install.sh` (Linux branch):
  1. `mkdir -p ~/.config/systemd/user && cp bematist.service ~/.config/systemd/user/`
  2. `systemctl --user daemon-reload`
  3. `systemctl --user enable --now bematist.service`
  4. If `loginctl show-user $USER -p Linger` shows `Linger=no`, print a note that without `loginctl enable-linger`, the service stops at logout.

### Windows (Task Scheduler via PowerShell)

- [ ] `packaging/windows/install.ps1` — already exists as the chocolatey hook target? If not, create:
  - Registers a scheduled task via `Register-ScheduledTask` that runs at logon, runs hidden, and auto-restarts on failure.
- [ ] Bematist's Windows install path is more fiddly. Lower priority than macOS + Linux.

### Updated `bematist` CLI

- [ ] `bematist start` — alias for "make sure the OS service is loaded + running." Works on all three OSes (dispatches to launchctl/systemctl/Task Scheduler).
- [ ] `bematist stop` — mirror.
- [ ] `bematist status` — surfaces running / not running / never loaded + log-tail hint.
- [ ] `bematist logs` — tails `~/.bematist/logs/*.log`.

### Tests

- [ ] macOS fixture: run `install.sh` in a CI macos runner; assert `launchctl list | grep dev.bematist.collector` succeeds.
- [ ] Linux fixture: same with `systemctl --user`.
- [ ] Crash-test: kill the process; assert launchd/systemd restarts within 5s.

### Not in scope for L2
- Uninstall story. Users would have to `launchctl bootout` / `systemctl --user disable` by hand until L3.

---

## Level 3 — Distro packages (first-class native install)

**Goal:** users install Bematist the way they install any other CLI tool on their OS. `brew install bematist`, `apt install bematist`, `yay -S bematist-bin`, `choco install bematist`. The package handles binary placement, service registration, upgrades, and clean uninstall.

**Effort:** ~1 week end-to-end (mostly provisioning waits — first-upload moderation, repo/signing key generation, tap/apt-repo hosting decisions).

### What already exists (tonight's audit)

`.github/workflows/release.yml` scaffolds every channel. All publishing jobs are gated `if: false` pending owner-side provisioning. Per-channel render scripts already produce the artifacts:

- `packaging/deb/build.sh` → `.deb` package (linux-amd64 + linux-arm64)
- `packaging/homebrew/render.sh` + `packaging/homebrew/bematist.rb.tmpl` → Homebrew formula
- `packaging/aur/render.sh` → AUR PKGBUILD
- `packaging/choco/render.sh` → Chocolatey `.nuspec` + tools

Current blockers (beyond provisioning):
- All render scripts **hard-code `darwin-x64`** as a required binary. We skip darwin-x64 in v0.1.x, so `bash packaging/homebrew/render.sh` fails. Fix before any channel flips on.

### Overall shape

For each channel:

1. **Render** the package manifest from the release assets (shipping today as workflow artifact, not published).
2. **Publish** to the channel's upstream (tap repo / apt repo / AUR git / Chocolatey).
3. **Install test** in CI (`brew install`, `apt install`, etc.) against the previous release before cutting a new tag.
4. **Uninstall test** to verify clean removal of binary + launchd/systemd unit + config.

Each channel is independent — flip the workflow guard one at a time as provisioning completes.

---

### Channel 1 — Homebrew (macOS + Linux)

Priority: **highest** (majority of dev-facing install).

#### Prereqs (one-time, outside the repo)

1. **Create** `github.com/bematist-org/homebrew-tap` (or `github.com/pella-labs/homebrew-tap`). Must be a standalone repo; name MUST start with `homebrew-`.
2. **Populate** it with:
   - `Formula/bematist.rb` — placeholder; CI will overwrite per release
   - `README.md` — install instructions (`brew install <org>/tap/bematist`)
   - `.github/workflows/test.yml` — `brew test-bot` on PRs
3. **Create a fine-grained PAT** on an account with push access to the tap repo (scope: Contents:read-write on the tap repo only). Store as GH Actions secret `HOMEBREW_TAP_TOKEN` on the main repo.

#### Code changes

- [ ] Update `packaging/homebrew/bematist.rb.tmpl` to drop the `darwin-x64` URL block (or conditionally emit based on which binaries exist in `$dist`).
- [ ] Update `packaging/homebrew/render.sh` to `continue` rather than `exit 1` when a target binary is missing — emit only the `on_macos` / `on_linux` / arch-matching stanzas that are actually present.
- [ ] Add a `brew services`-compatible start hook in the formula (`service do ... end` block) that registers the LaunchAgent from L2. On `brew install`, `brew services start bematist` launches it.
- [ ] Post-install caveat: print a reminder to configure `~/.bematist/config.env` with the endpoint + token if they weren't passed (`brew install` doesn't get the install.sh env-var trick).

#### CI changes

- [ ] Flip `.github/workflows/release.yml` `publish-homebrew` job guard from `if: ${{ false && … }}` to `if: ${{ !contains(needs.meta.outputs.tag, '-') }}` so it runs on non-prerelease tags.
- [ ] Add a pre-release step: spin up `brew test-bot` inside the formula PR to `<tap>` and fail the release if it doesn't pass.

#### Acceptance

- [ ] `brew tap bematist-org/tap && brew install bematist` on a fresh macOS VM.
- [ ] `brew services start bematist` — LaunchAgent loaded, `bematist status` shows running.
- [ ] `brew uninstall bematist` — binary gone, LaunchAgent bootout'd, `~/.bematist/config.env` preserved (user data).
- [ ] `brew upgrade bematist` on a new tag — binary replaced, service restarted without re-asking for token.

---

### Channel 2 — Debian/Ubuntu apt

Priority: **high** (primary Linux channel for most devs).

#### Prereqs

Decide on a repo host. Three options, ordered by effort:

| Option | Pros | Cons |
|---|---|---|
| **OBS (OpenSUSE Build Service)** free tier | No infra to run; GPG key management solved | Branding says OpenSUSE in URLs; 404 surface |
| **Self-host on S3 + CloudFront** (bematist-apt bucket + `reprepro`/`aptly`) | Total control, clean `apt.bematist.dev` URL | Need AWS infra, GPG key rotation, Debian-repo sync script |
| **Cloudsmith** (hosted apt repo, free dev tier) | Clean URL, zero infra, signing baked in | Vendor lock-in, paid beyond free tier |

Recommend **Cloudsmith** for fastest ship + cleanest URL, migrate to self-host later when scale warrants.

#### Once a repo is picked

- [ ] Generate an `RSA 4096` GPG key for package signing. Store private key as GH secret `APT_SIGNING_KEY`. Publish public key at `https://bematist.dev/apt/public.gpg`.
- [ ] Update `.github/workflows/release.yml`'s `publish-deb` job:
  - `gpg --batch --import $APT_SIGNING_KEY`
  - `reprepro --basedir /tmp/apt-repo includedeb stable dist/bematist_*.deb`
  - `gpg --detach-sign --armor /tmp/apt-repo/dists/stable/Release > Release.gpg`
  - `gpg --clearsign /tmp/apt-repo/dists/stable/Release > InRelease`
  - Sync to Cloudsmith (or S3) via their CLI/API.
  - Purge CDN edges if using S3+CloudFront.
- [ ] Post-install script in the `.deb` (existing in `packaging/deb/build.sh`) — register the systemd unit from L2.

#### User-facing install

```sh
curl -fsSL https://bematist.dev/apt/public.gpg | sudo tee /etc/apt/trusted.gpg.d/bematist.gpg
echo 'deb https://bematist.dev/apt stable main' | sudo tee /etc/apt/sources.list.d/bematist.list
sudo apt update
sudo apt install bematist
```

#### Acceptance

- [ ] `apt install bematist` on a fresh Ubuntu 22.04 + Debian 12 container.
- [ ] `systemctl --user status bematist` — running after install.
- [ ] `apt upgrade bematist` picks up a new tag.
- [ ] `apt remove --purge bematist` — binary gone, systemd unit disabled + removed, config preserved.

---

### Channel 3 — AUR (Arch)

Priority: **medium**. Smaller audience but highest-signal — Arch users are influential among devs.

#### Prereqs

1. Create an AUR account (`aur.archlinux.org/register`).
2. Generate an SSH key, add it to the AUR account.
3. Reserve `bematist-bin` (AUR convention: `-bin` suffix for binary-distributed packages vs source builds).
4. Store the SSH private key as GH secret `AUR_SSH_KEY`.

#### Code

- [ ] `packaging/aur/render.sh` renders a `PKGBUILD` — skip darwin-x64 (Arch is Linux-only anyway; verify the script filters correctly).
- [ ] Generate `.SRCINFO` via `makepkg --printsrcinfo` in CI (requires `archlinux` container).
- [ ] Flip `publish-aur` guard:
  - `ssh-agent bash -c 'echo "$AUR_SSH_KEY" | ssh-add -'`
  - `git clone ssh://aur@aur.archlinux.org/bematist-bin.git aur-pkg`
  - Overwrite `PKGBUILD` + `.SRCINFO`
  - `git add -A && git commit -m "bematist $TAG" && git push`

#### Acceptance

- [ ] `yay -S bematist-bin` on a fresh Arch container.
- [ ] Systemd unit registered + started via the `post_install()` hook in PKGBUILD.
- [ ] `yay -Rns bematist-bin` — clean uninstall.

---

### Channel 4 — Chocolatey (Windows)

Priority: **medium**. Windows audience is smaller for AI-engineering tooling, but the team has David on Windows.

#### Prereqs

1. Register a Chocolatey community account.
2. First-package moderation: plan on a **~1 week wait** for the initial `bematist` package approval. Each subsequent tag is auto-approved if trusted.
3. Store `CHOCO_API_KEY` as GH secret.

#### Code

- [ ] `packaging/choco/render.sh` renders `bematist.nuspec` + `tools/chocolateyInstall.ps1` (Scheduled Task registration from L2).
- [ ] Flip `publish-choco` guard:
  - `choco pack bematist.nuspec`
  - `choco push bematist.$version.nupkg --api-key $CHOCO_API_KEY --source https://push.chocolatey.org/`

#### Acceptance

- [ ] `choco install bematist` on Windows 11.
- [ ] `bematist status` — scheduled task registered, process running.
- [ ] `choco uninstall bematist` — clean.

---

## Rollout order

1. **Week 1** — L1 config persistence ships. Welcome page one-liner becomes copy-paste self-contained. `curl | sh` still primary.
2. **Week 2** — L2 daemon units ship. Welcome page one-liner ends with "Bematist is now running in the background. Your data appears in the dashboard within a minute."
3. **Week 3** — Homebrew tap live. `brew install` becomes documented primary path for macOS.
4. **Week 4** — apt repo + AUR live. Linux devs have first-class install.
5. **Week 5** — Chocolatey (if moderation pending, push the PR; install path is documented manually in the meantime).

Release workflow deltas are additive — each channel is flipped independently without affecting the binaries in the GH Release.

---

## Open questions for the first install-day

- **Where does the install.sh fetch the config from on a fresh machine that's never been logged in?** Answer: the welcome page's one-liner has the endpoint + token inline. First install writes the config; subsequent installs skip (or update if a new token is passed).
- **How do we revoke a teammate's collector remotely?** Ingest-key revoke path already exists — admin clicks Revoke in `/admin/ingest-keys`, the bearer 401s within the 60s LRU window. Collector keeps trying; admin should mint + send a new one.
- **What about dual-machine setup (laptop + work desktop)?** Two options:
  1. Same bearer on both machines. Works today. Events look like one engineer from both.
  2. Mint separate keys per machine, tag them differently. Dashboard surface can show per-device rollup. That's a future dashboard feature — skip until asked.
- **Offline-first behavior?** Today: collector buffers in egress journal if ingest unreachable, retries on next poll. Fine.
- **Air-gapped enterprise installs?** Out of scope for M5. Mentioned in CLAUDE.md as a Phase 3+ concern.

---

## Where to start tomorrow

1. Read `m5-handoff.md` — resume-from-clean-context.
2. Run `bematist doctor` in a fresh terminal to confirm the L0 pain (env vars don't persist).
3. Start on **L1 Tasks**. The install.sh + collector config loader are the two files to edit. Test locally before re-tagging.
4. When L1 is green, tag `v0.1.1` — release workflow ships automatically.
5. Update welcome page + onboarding doc to reflect the new one-liner.
6. Ping Sandesh + Walid to re-install using the cleaner flow — their muscle memory from tonight will re-test every edge.
