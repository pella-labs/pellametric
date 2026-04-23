# Release Lead Verdict

## 1. Password rotation: ESCALATE-TO-USER
The lead cannot rotate Railway passwords, but shipping OSS with live plaintext credentials exposed in git history is not a release-velocity tradeoff we can make — it is a hard gate. Flagging in SUMMARY.md while proceeding would publish working DB creds to the world the moment the repo flips public, which is a breach, not an ergonomics issue. The user (or whoever owns the Railway project) must rotate before the repo is made public; Release Lead formally escalates and pauses the public-flip step until confirmation. All other cleanup can proceed in parallel.

## 2. Git history scrub: HOLD
Force-pushing a filter-repo'd history rewrites every collaborator's SHAs, breaks in-flight PRs (including `origin/feat/card-details` where the leak lives), and invalidates existing clones — a painful contributor-experience hit right before going public. Since rotation (verdict #1) is the real fix, history scrub becomes security theater: rotated creds in history are harmless. Hold the rewrite; if rotation confirms, we simply delete the file at HEAD and document the old commit as "contained now-revoked credentials" in SUMMARY.md. This preserves commit SHAs, PR continuity, and signed tags.

## 3. Delete scripts/migrate-cards.mjs: PROCEED
One-shot migration script with hard-coded prod DB URLs has zero business being in an OSS repo regardless of rotation status. Deleting from the working tree is cheap, non-breaking (nothing imports it — it's a manual `node` invocation), and removes the footgun for contributors who might copy it. Do it now as part of the cleanup commit.

## 4. Move collector.mjs to build-time: PROCEED
Verified: root `package.json` build script already runs `apps/collector run build` before `apps/web run build`, which bundles to `apps/web/public/collector.mjs` via `apps/collector/build.ts`. The Dockerfile runs `bun run build` so Railway gets a fresh artifact. The file is served at `/collector.mjs` to end users (curl one-liner at `apps/web/app/setup/collector/page.tsx`), but nothing else references the checked-in copy. Safe to delete the committed artifact and add `apps/web/public/collector.mjs` to `.gitignore` — reduces repo size, removes 950 lines of generated noise from OSS diffs, and eliminates drift between source and bundle.

## 5. License MIT, copyright "Pella Labs": PROCEED
`package.json` has no `license` field today — an unlicensed public repo is legally "all rights reserved" and contributors cannot fork or PR, which defeats the open-source release. No `LICENSE` file exists either. Add `LICENSE` (MIT, `Copyright (c) 2026 Pella Labs`) at repo root and add `"license": "MIT"` to `package.json`. Zero-risk, maximum-ergonomics, unblocks the whole OSS value prop.
