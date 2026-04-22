# Plan — pnpm → bun + collector binary + auto-start

## Goal

Convert the repo from pnpm to bun so we can ship `apps/collector` as a
`bun build --compile` single-file binary on macOS (arm64/x64), Linux
(x64/arm64), and Windows (x64). The collector stops being a one-shot CLI
and becomes a long-running process that streams Claude Code + Codex
session data as new events are written, installed as a per-user service
that auto-starts on login.

Token-based developer identification stays: the collector reads a
bearer token from `~/.pella/config.env` and sends it as
`Authorization: Bearer pm_…` to `/api/ingest`.

Reference implementation: `~/dev/gauntlet/analytics-research` (bematist).

## Verified facts

- `/api/ingest` at `apps/web/app/api/ingest/route.ts:115` uses
  `onConflictDoUpdate` on `(userId, source, externalSessionId)` — clean
  upsert with last-write-wins on every accumulating field. **No server
  changes are required for the light-streaming design.**
- The current paste-the-token one-liner
  (`curl … /collector.mjs | node - --token pm_…`) is rendered by
  `apps/web/app/setup/collector/page.tsx:56` and must keep working.
- Current collector deps: `tsx`, `esbuild`, `@pella/shared`. Build
  target today is `web/public/collector.mjs`.

## Decisions (locked)

1. **Streaming mechanism:** light. Poll every 10s, per-file byte-offset
   cursor in `~/.pella/cursors.json`, re-upload any session that got new
   lines that cycle. Relies on the `/api/ingest` upsert confirmed above.
   No SQLite journal.
2. **Auth UX:** keep `--token` paste. `pella login --token pm_xxx`
   writes `~/.pella/config.env` and then invokes `pella start`.
3. **Ingest semantics:** confirmed upsert — see above.
4. **Railway:** migrate to a `Dockerfile` using `oven/bun:1.3-slim`.
5. **Windows:** day-one support.
6. **PR sequence:** three PRs (below).
7. **Legacy `collector.mjs`:** keep it alive, produced via
   `bun build --target=node`.
8. **Binary name:** `pella`.

---

## PR1 — pnpm → bun (no behavior change)

**Goal:** green CI, working `bun run dev`, same functional behavior, zero
new features.

### Files to change

- `package.json` (root)
  - `packageManager: "bun@1.3.4"` (drop `pnpm@9.12.0`).
  - Replace `engines.node` with `engines.bun: ">=1.3.4"`.
  - Add `"workspaces": ["apps/*", "packages/*"]`.
  - Rewrite every script `pnpm --filter X Y` → `bun --filter X Y`.
  - `test`, `typecheck`: `pnpm -r X` → `bun --filter='./apps/*' --filter='./packages/*' X`.
- Delete `pnpm-workspace.yaml`.
- Delete `pnpm-lock.yaml`.
- `apps/collector/package.json`
  - `start`: `bun src/index.ts` (was `tsx src/index.ts`).
  - `dev`: `bun --hot src/index.ts` (was `tsx watch …`).
  - `build`: `bun build src/index.ts --target=node --outfile=../web/public/collector.mjs --define:__DEFAULT_URL__='"https://pella-web-production.up.railway.app"'`
    (replaces the `esbuild` invocation; keeps the same output path).
  - Drop `tsx` and `esbuild` from `devDependencies`.
- `apps/web/package.json` — no script changes needed (Next + drizzle-kit
  work under bun). Drop `@types/node` redundancy if any.
- `.github/workflows/ci.yml`
  - Replace `pnpm/action-setup@v4` + `actions/setup-node@v4` with
    `oven-sh/setup-bun@v2` (all three jobs: typecheck, test, build).
  - `pnpm install --frozen-lockfile` → `bun install --frozen-lockfile`.
  - Job commands: `bun run typecheck`, `bun run test`,
    `bun --filter @pella/web build`, `bun --filter @pella/collector build`.
- `Dockerfile` (new, at repo root) — multi-stage build on
  `oven/bun:1.3-slim`, `bun install --frozen-lockfile`, `bun run build`,
  runtime stage runs `bun --filter @pella/web start`. Expose `$PORT`.
- `railway.toml`
  - `[build].builder = "DOCKERFILE"`, remove `buildCommand`.
  - `[deploy].startCommand = "bun --filter @pella/web start"` (or leave
    it to the Dockerfile `CMD`).

### Verification

- `bun install` produces `bun.lock`; commit it.
- `bun run typecheck` → zero errors.
- `bun run test` → all existing vitest suites pass (vitest runs under
  bun's node-compat just fine).
- `bun run build` → both `apps/web/.next/` and
  `apps/web/public/collector.mjs` rebuild successfully.
- `bun run dev` → web app boots on :3000, drizzle-kit still connects.
- CI matrix (typecheck, test, build) green on a PR.
- `docker build .` succeeds locally and the resulting image serves the
  dashboard.

---

## PR2 — collector daemon + `bun build --compile` binary

**Goal:** the collector is a long-running process that streams session
data. `bun build --compile` produces a single-file binary for all five
targets. `pella start` installs it as a user-level service on
macOS/Linux/Windows and the service auto-starts on login.

### New layout under `apps/collector/src/`

```
index.ts              # legacy one-shot entry; powers collector.mjs
bin.ts                # `bun build --compile` entry; delegates to cli.ts
cli.ts                # arg dispatch
config.ts             # ~/.pella/config.env read/write
serve.ts              # the streaming loop
cursor.ts             # ~/.pella/cursors.json: {[absPath]: {size, mtimeMs, offset}}
parsers/
  claude.ts           # extracted from current index.ts, resume-from-offset
  codex.ts            # extracted from current index.ts, resume-from-offset
  repo.ts             # resolveRepo() — unchanged from index.ts
  intent.ts           # classifyIntent() — unchanged
commands/
  login.ts            # --token flag; writes config; invokes start
  logout.ts           # delete config.env
  start.ts            # install + start per platform
  stop.ts             # stop + uninstall per platform
  status.ts           # parse launchctl/systemctl/schtasks output
  logs.ts             # tail log files or journalctl
  serve.ts            # foreground run — the service ExecStart target
  runOnce.ts          # legacy one-shot; what index.ts calls today
daemon.ts             # per-platform install/start/stop/status — modeled on
                      # bematist's apps/collector/src/daemon.ts
templates.ts          # inline the three packaging templates as strings
                      # (so the compiled binary is self-contained)
```

### Streaming loop (`serve.ts`)

Poll interval default 10 000ms (env: `PELLA_POLL_INTERVAL_MS`).

On each tick:

1. Walk `~/.claude/projects/**/*.jsonl` and
   `~/.codex/sessions/**/rollout-*.jsonl`,
   `~/.codex/archived_sessions/**/rollout-*.jsonl`.
2. For each file, load its cursor. If `size < cursor.size` or
   `mtimeMs < cursor.mtimeMs` → file was rotated/truncated, reset cursor
   to 0.
3. Open, seek to `cursor.offset`, read to EOF, split on `\n`, parse JSON
   lines, fold into in-memory per-session accumulators (same schema as
   `finalize()` in current `index.ts`). Track which `sessionId`s were
   touched this cycle (the "dirty set").
4. For dirty sessions whose `cwd` resolves to a known repo, run
   `finalize()` and upload in batches of 200 via POST `/api/ingest`
   with `Authorization: Bearer <token>`.
5. **Only on HTTP 200**, persist the new cursor offsets for the files
   whose data contributed to that batch. On 4xx/5xx, leave cursors
   where they were — next tick retries from the last successful offset.
6. SIGINT / SIGTERM: stop ingesting new lines, finish the in-flight
   POST, persist cursors, close, `process.exit(0)`.

Accumulators live in-process. They're rebuilt from scratch on restart
because `/api/ingest` upserts — we read the whole JSONL from the start
on boot, send the current state, and from then on resume from cursor.
The first boot after install walks everything once and backfills. Every
subsequent tick ships deltas only.

### CLI surface (`cli.ts`)

```
pella login --token pm_xxx [--url https://…] [--no-start]
pella logout
pella start                  # install + start OS service
pella stop                   # stop OS service (unit file preserved)
pella status                 # running / stopped / not-installed
pella logs                   # tail the service's stdout/stderr
pella serve                  # foreground loop (what the service runs)
pella run-once               # current one-shot behavior, preserved
pella --version | -v | version
pella help | --help | -h
```

`pella login` writes `~/.pella/config.env` (600) with
`PELLA_TOKEN=…` and `PELLA_URL=…`, then (unless `--no-start`) calls the
same code path as `pella start`.

### Per-platform daemon

Modeled directly on `~/dev/gauntlet/analytics-research/apps/collector/src/daemon.ts`:

- **macOS:** LaunchAgent at `~/Library/LaunchAgents/dev.pella.collector.plist`.
  `launchctl bootstrap gui/<uid> <plist>` then `launchctl kickstart -k -s …`.
  `RunAtLoad=true`, `KeepAlive=true`, `ThrottleInterval=10`,
  `SoftResourceLimits.Core=0`. Logs to `~/.pella/logs/{out,err}.log`.
- **Linux:** systemd --user unit at
  `~/.config/systemd/user/pella.service`. `systemctl --user daemon-reload`
  then `systemctl --user enable --now pella.service`. Warn if linger
  isn't enabled. Logs via journalctl (`pella logs` shells out).
- **Windows:** Scheduled Task at `\Pella\Collector`, `LogonTrigger` for
  the current user, `InteractiveToken`, `RestartOnFailure` 3× every 5s,
  registered via `schtasks /Create /XML … /F` then `schtasks /Run`.

### Packaging templates (new directory: `packaging/`)

```
packaging/launchd/dev.pella.collector.plist.tmpl
packaging/systemd/pella.service.tmpl
packaging/windows/pella-task.xml.tmpl
```

Adapted from the bematist templates with `bematist` → `pella`,
`BEMATIST_` → `PELLA_`, paths from `~/.bematist/` → `~/.pella/`. Content
is inlined into `templates.ts` as string constants at build time so the
compiled binary doesn't depend on finding template files on disk.

### Build scripts (added to `apps/collector/package.json`)

```
"build:darwin-arm64":  "bun build --compile --minify --sourcemap --target=bun-darwin-arm64  src/bin.ts --outfile bin/pella-darwin-arm64 && codesign --remove-signature bin/pella-darwin-arm64 && codesign --force --sign - bin/pella-darwin-arm64"
"build:darwin-x64":    "bun build --compile --minify --sourcemap --target=bun-darwin-x64    src/bin.ts --outfile bin/pella-darwin-x64   && codesign --remove-signature bin/pella-darwin-x64   && codesign --force --sign - bin/pella-darwin-x64"
"build:linux-x64":     "bun build --compile --minify --sourcemap --target=bun-linux-x64     src/bin.ts --outfile bin/pella-linux-x64"
"build:linux-arm64":   "bun build --compile --minify --sourcemap --target=bun-linux-arm64   src/bin.ts --outfile bin/pella-linux-arm64"
"build:windows-x64":   "bun build --compile --minify --sourcemap --target=bun-windows-x64   src/bin.ts --outfile bin/pella-windows-x64.exe"
```

(`--no-compile-autoload-dotenv` from bematist is optional — we don't
want the compiled binary auto-loading a random `.env` from the user's
cwd either, so we'll include it.)

`bin/` is added to `.gitignore`.

### Verification

- Local build of all 5 targets succeeds on darwin-arm64 (cross-compile
  via `bun build --target=…` is single-command).
- `./bin/pella-darwin-arm64 --version` prints the version.
- `./bin/pella-darwin-arm64 login --token <test>` writes
  `~/.pella/config.env`.
- `./bin/pella-darwin-arm64 start` installs and loads the LaunchAgent;
  `launchctl print gui/$(id -u)/dev.pella.collector` shows
  `state = running`.
- After a few Claude Code turns, new rows appear in the DB via
  `/api/ingest` without re-running anything.
- `./bin/pella-darwin-arm64 stop` bootouts the unit.
- Parallel: on a Linux box (via Docker or a VM), `pella start` enables
  the systemd user unit and `systemctl --user status pella.service`
  shows `active (running)`.
- On a Windows VM: `pella.exe start` registers the Scheduled Task;
  `schtasks /Query /TN \Pella\Collector` shows `Running`.
- Legacy `collector.mjs` still works:
  `curl … /collector.mjs | node - --token pm_…` does exactly what it
  did before PR1 (one-shot upload, exit 0).

---

## PR3 — distribution

**Goal:** `curl | sh` install path + GH Releases + updated setup page.

### New files

- `packaging/install.sh` — adapted from
  `~/dev/gauntlet/analytics-research/packaging/install.sh`. Accepts
  `--token pm_xxx`, `--url https://…`, `--prefix /usr/local`,
  `--version v0.1.0`. Detects os/arch, downloads
  `pella-<os>-<arch>[.exe]` + `SHA256SUMS` from the latest GH Release
  matching `--version` (or just `latest`), verifies the sha, installs
  to `$prefix/bin/pella`, writes config, runs `pella start`. Wrapped in
  a `main()` function so a truncated pipe can't execute a partial
  script.
- `packaging/install.ps1` — Windows equivalent: downloads
  `pella-windows-x64.exe` + sha, verifies via `Get-FileHash`, places
  in `$env:LOCALAPPDATA\Pella\pella.exe`, writes
  `$env:USERPROFILE\.pella\config.env`, invokes `pella.exe start`.
- `.github/workflows/release.yml` — on `v*` tag push:
  - Matrix across the 5 targets (`darwin-arm64` / `darwin-x64` needs
    macOS runner for codesign; linux + windows on ubuntu-latest with
    cross-compile).
  - Upload each `pella-<target>` binary to the GH Release.
  - Generate + upload `SHA256SUMS`.

### Changes

- `apps/web/public/install.sh` — served directly as a static file
  (mirror of `packaging/install.sh`). Next.js serves `/public/*` at the
  site root, so the URL becomes
  `https://pella-web-production.up.railway.app/install.sh`.
  (Alternative: a Next route that returns the file — simpler to keep it
  in `public/`.)
- `apps/web/public/install.ps1` — same, for Windows PowerShell.
- `apps/web/app/setup/collector/page.tsx` — restructure sections:
  - 01 · get a token (unchanged)
  - 02 · install (new, primary)
    - macOS / Linux:
      `curl -fsSL https://pella-web-production.up.railway.app/install.sh | sh -s -- --token pm_…`
    - Windows:
      `irm https://pella-web-production.up.railway.app/install.ps1 | iex`
      (with an env prefix to pass the token, or an interactive
      prompt — TBD during PR3).
  - 03 · advanced / one-shot (the current `collector.mjs` node
    one-liner, kept as a fallback).
- `README.md` — add a "Install the collector" section with the install
  one-liners, plus a "Build from source" section documenting the
  `bun run build:<target>` matrix.

### Verification

- Push a `v0.0.2` tag → `release.yml` builds and publishes all 5
  binaries + `SHA256SUMS` to a GH Release.
- On a fresh mac:
  `curl -fsSL …/install.sh | sh -s -- --token <real-token>` → binary
  at `/usr/local/bin/pella`, service running, data flowing within one
  poll cycle.
- Same on a fresh Linux box and a Windows box.
- Existing Node-one-liner still functions for users who never upgrade.

---

## Out of scope

- OAuth device-authorization login flow (`bematist login` shape) — we
  explicitly chose to keep the `--token` paste.
- SQLite journal with deterministic event IDs and server-side dedup —
  we explicitly chose light-streaming.
- Cosign / GH OIDC signing on release artifacts — SHA256SUMS only for
  now.
- Homebrew / Chocolatey / AUR packaging — `install.sh` + `install.ps1`
  only.
- Auto-update. `pella` will not self-update; users re-run `install.sh`
  to upgrade.
