# Bematist — Team onboarding (post-M4 cutover)

> **TL;DR** — Sign up at the dashboard, copy the one-liner on the welcome page, paste it in your terminal. Collector starts tailing your Claude Code / Codex / Cursor / Continue.dev sessions and ships events to the Railway-hosted dev ingest. No Tailscale.

> **Superseded:** the Tailscale-era flow (per-dev pre-seeded `BEMATIST_TOKEN`s against `100.88.123.96`) — see git history if you need to compare. That setup is done.

---

## 1. Sign up

1. Open the dashboard — **https://app.bematist.dev** (prod) or **http://localhost:3000** if you're running the web app locally.
2. Click **"Sign up with GitHub"** on the landing page.
3. GitHub OAuth. First-time signers get their own org and are promoted to **admin** of it; you can invite your team from here.

On the **welcome page** you'll see an install one-liner like:

```sh
curl -fsSL https://github.com/pella-labs/bematist/releases/latest/download/install.sh \
  | BEMATIST_ENDPOINT=https://ingest-development.up.railway.app \
    BEMATIST_TOKEN=bm_<orgSlug>_<keyId>_<secret> \
    sh
```

**Copy it immediately** — the bearer plaintext is shown exactly once (we only store a sha256). Reloading wipes it; you'd have to mint a new key from **/admin/ingest-keys**.

---

## 2. Install the collector

Paste the one-liner in your terminal.

- The installer downloads the binary for your platform (darwin-arm64, linux-x64/arm64, windows-x64).
- Verifies SHA-256 against the release manifest (signed by GitHub OIDC).
- Installs to `/usr/local/bin/bematist` (override with `--prefix`).

Optional cosign verification for the extra-paranoid:

```sh
curl -fsSL https://github.com/pella-labs/bematist/releases/latest/download/install.sh | sh -s -- --verify-cosign
```

---

## 3. Start the collector

```sh
BEMATIST_ENDPOINT=https://ingest-development.up.railway.app \
BEMATIST_TOKEN=<your-bearer-from-welcome> \
bematist serve
```

Leave it running in a terminal tab. `Ctrl+C` to stop.

First poll walks your historical `~/.claude/projects/*.jsonl`, Claude Code Codex, Cursor, and Continue.dev state files — backfill can take several minutes on a big history. Subsequent polls re-walk but server-side Redis `SETNX` dedup ensures each event lands exactly once.

**Quiet terminal?** Default `BEMATIST_LOG_LEVEL=warn`. Add `BEMATIST_LOG_LEVEL=info` to the env above to see `adapters emitted events {count}` lines so you can watch progress.

---

## 4. Invite your team

If you're the admin, visit **/admin/invites**:

1. Click **"Generate invite link"**.
2. Copy the `/join/<token>` URL and send it via Slack / email / whatever.
3. Your teammate clicks the link, signs in with GitHub, lands in your org as **role=ic** with their own freshly minted ingest key and one-liner install command.

Invite links expire after 14 days by default. Revoke anytime from the same admin page.

---

## 5. Verify it's working

```sh
bematist doctor     # adapters + ingest reachability round-trip
bematist status     # active adapters, last event, queue depth, version
bematist audit --tail | head -20    # inspect the last bytes that left your machine
```

Expected: all adapters green, `ingest reachable: yes`.

Then fire a real Claude Code / Codex / Cursor / Continue.dev session and check the dashboard:
- **Your sessions:** `/sessions`
- **Your personal digest:** `/me/digest`
- **Team digest (admin-only):** `/team/<your-org-slug>/digest`

You should see your first session within ~60s of finishing a turn.

---

## 6. What gets sent

Default tier is **B** (counters + redacted envelopes) — the same posture as Anthropic's own `OTEL_LOG_USER_PROMPTS=0`. Token counts, cost, session timings, redacted prompt envelopes. **No raw prompt text, no code, no tool output, no file paths** — the collector abstracts + redacts on-device before any network call (see CLAUDE.md §"Clio-adapted on-device prompt pipeline").

Full rules at **/privacy** (Bill of Rights, when the compliance flag is on).

To stop sending at any point: `Ctrl+C` the collector terminal. Nothing's buffered on the network after that.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `bematist doctor` reports `ingest reachable: no` | Confirm `BEMATIST_ENDPOINT=https://ingest-development.up.railway.app` (no trailing slash, no `/v1/events`). |
| Welcome page shows "view in /admin/ingest-keys" instead of a command | You already signed up — the one-time bearer handoff was consumed. Mint a new key from /admin/ingest-keys. |
| Install one-liner fails on SHA-256 mismatch | `rm -rf ~/.cache/bematist && retry`. If it persists, ping Sebastian — may be a mid-release artifact mirror lag. |
| Signup never lands on /welcome | Clear cookies for the dashboard host; the post-auth redirect uses Better Auth session cookies. |
| Binary dies immediately on macOS | Apple Silicon binary is ad-hoc signed at release time. If Gatekeeper still complains, `xattr -d com.apple.quarantine "$(which bematist)"`. |

---

## Rollout plan

Tonight (cutover): Sebastian signs up, tests E2E, mints invites for Sandesh / Walid / Jorge / David. Tailscale collector commands from the prior M4 rehearsal stop working — tokens are tied to the old `default` org which nobody owns anymore.

Tomorrow: distro packages (Homebrew, apt, AUR, Chocolatey) come up; the `curl | sh` becomes fallback rather than primary.

---

## Questions

Ping Sebastian in Slack. Everything here is dev state — we're shaking out the real onboarding before the managed-cloud beta.
