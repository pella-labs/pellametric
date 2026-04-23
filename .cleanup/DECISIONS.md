# Team-Lead Decisions — Synthesized from Security + Release Verdicts

User authorized the crew to operate autonomously. The team lead synthesizes
the SecurityLead and ReleaseLead verdicts below and locks the execution
guidance for downstream teammates (Pruner, Refactorer, Docs, Verifier).

Read alongside `SECURITY_VERDICT.md` and `RELEASE_VERDICT.md`.

## 1. Railway password rotation — MANUAL FOLLOW-UP (P0)

Team lead cannot rotate credentials. Both leads said ESCALATE. The Pruner
will proceed with cleanup, and the Verifier will list this in `SUMMARY.md`
as the top P0 manual follow-up: **"DO NOT publish this repo publicly until
the Railway Postgres credentials for `switchyard.proxy.rlwy.net` and
`shinkansen.proxy.rlwy.net` have been rotated."**

## 2. Git history scrub — HOLD

Both leads said HOLD. Reasoning: credentials are already on GitHub (commit
`d823576`, branch `feat/card-details`); scrubbing without rotation is
theater, and force-push on `main` would orphan collaborator clones and
in-flight PRs. Verifier documents the offending commit SHA in `SUMMARY.md`
and notes that history-scrub, if desired, should happen *after* rotation
and in a coordinated session with the user — not in this crew's scope.

## 3. Delete `scripts/migrate-cards.mjs` — PROCEED

Both leads PROCEED. Pruner deletes the file. No references in `package.json`
scripts, `Dockerfile`, `railway.toml`, or app source. It is a one-shot
migration script with leaked credentials and no ongoing value.

## 4. Move `apps/web/public/collector.mjs` to build-time — HOLD

Leads disagreed. SecurityLead found the file is runtime-served at
`/setup/collector` via curl; un-tracking it without re-wiring the build
pipeline is a deploy risk with zero security value (no secrets in the
artifact). Team-lead call: **HOLD**. Pruner leaves `collector.mjs` alone.
Verifier notes in `SUMMARY.md` as a follow-up: "Consider gitignoring
`apps/web/public/collector.mjs` once the Dockerfile build step is updated
to regenerate it — defer to a separate PR."

## 5. LICENSE: MIT, copyright "Pella Labs" — PROCEED

Both leads PROCEED. No existing `LICENSE` file; no `license` field in any
`package.json`. Docs teammate creates `LICENSE` (MIT, `Copyright (c) 2026
Pella Labs`) and adds `"license": "MIT"` to root + workspace
`package.json` files.

## Additional guidance forwarded to downstream teammates

- **Pruner**: execute P-001 (delete stale planning docs), P-003 (remove
  working-tree `.DS_Store`), P-004 (strip 3 `console.error` from API
  routes), P-005 DO NOT execute (collector.mjs HOLD above). Add a new
  deletion for `scripts/migrate-cards.mjs` under P-002 (which replaces the
  retracted "unused deps" P-002). After deletion, run `bun install`,
  `bun run typecheck`, `bun run build`.
- **Refactorer**: R-001 (combined `withAuth` + `apiError`), R-002
  (`githubHeaders` helper only), R-003 (extract icons + single `Slide.tsx`
  dispatcher — do NOT create 8 near-duplicate slide files), R-004 (rename
  `card-backend.ts` → `card-tokens.ts`). R-005 deleted. R-006 merged into
  R-001.
- **Docs**: D-001 (`.env.example` with all 13+ vars including
  `PELLA_BIN`; document `drizzle.config.ts` reads `.env` not `.env.local`),
  D-002 (augment README for OSS, not rewrite from scratch — include short
  Contributing section in README; no separate CONTRIBUTING.md), D-003
  (LICENSE: MIT, Pella Labs, 2026), D-005 (Dockerfile: switch
  `BETTER_AUTH_SECRET` from `ENV` to `ARG`, fail fast at runtime if real
  secret missing).
- **Verifier**: Full verification. SUMMARY.md must include the three HOLD
  items above as explicit manual follow-ups, in priority order, with the
  exact actions the user needs to take.
