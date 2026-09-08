# Pellametric Insights Revamp — Research Brief (Loop 0)

> Output of the Researcher agent (Opus 4.6). All claims cited with URLs. Used as grounding input for Architect / Challenger / Design loops.

## A. PR ↔ session attribution techniques

**Finding.** No public vendor exposes its full attribution algorithm, but the pattern across Faros AI, LinearB, DX, Swarmia, and Jellyfish is the same: ingest signals from many tools (Git, IDE telemetry, issue trackers, AI assistants), then fuse them via a mapping layer that auto-resolves teams ↔ repos ↔ apps by inference rather than hard-coded config. Faros explicitly markets that it "infers the mapping between teams, apps, and repos, and auto-selects the best attribution method." For AI attribution specifically, DX has shipped a Copilot-aware integration that maps Copilot telemetry to organizational hierarchy and correlates AI-user vs non-AI-user PR Revert Rate and cycle time — i.e. cohort-level rather than commit-level attribution. The strongest deterministic heuristics in the public literature are: (1) extract a work-item key from branch name (e.g. `JRA-123-feature`), supported natively by GitHub, Bitbucket, GitLab, and Jira; (2) match work-item keys in commit messages; (3) link by author identity + time window; (4) match the IDE's `cwd` to the PR's repo. Jaccard overlap of `filesEdited(session)` ↔ `files(PR)` does not appear in any public engineering-analytics whitepaper, so it would be a novel signal — defensible but unproven. Confidence scoring of these joins is generally not surfaced by competitors; their dashboards present attribution as binary.

**Key numbers.**
- DX adoption benchmarks: leading orgs reach 60–70% weekly active AI usage, 40–50% daily — gives us a denominator for "% of PRs touched by AI."
- Jellyfish reports avg cycle-time improvement of ~25% and PR throughput gains of ~12% from AI tools across 500+ orgs — a useful sanity check for any cost-per-PR baseline.
- GitHub Copilot Metrics API has a 2-day lag and finalizes within 3 UTC days — anything Pellametric does in real time is already strictly fresher than GitHub's own dashboard.

**Gotchas.**
- Copilot org-level metrics are based on org membership, not where the action happened, so a user shows up in every org dashboard they belong to. We should pin attribution to repo-owner (already done) to avoid this.
- Copilot CLI metrics are tracked separately from IDE telemetry and don't roll into the same active-user count.

**Sources.**
- https://www.faros.ai/
- https://www.faros.ai/blog/best-dora-metrics-tools-2026
- https://getdx.com/blog/dx-expands-integration-with-github-copilot/
- https://getdx.com/research/measuring-developer-productivity-with-the-dx-core-4/
- https://docs.github.com/en/copilot/concepts/copilot-usage-metrics/copilot-metrics
- https://docs.github.com/en/copilot/reference/copilot-usage-metrics/reconciling-usage-metrics
- https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/linking-a-pull-request-to-an-issue
- https://support.atlassian.com/jira-software-cloud/docs/reference-issues-in-your-development-work/

**Confidence.** High on the pattern (multi-signal fusion + branch/commit/PR keyword extraction). Medium on novelty of filesEdited↔PR.files Jaccard — no precedent found, so we'd be inventing this primitive.

---

## B. Code provenance / blame at scale

**Finding.** There is a real, named open spec — **Cursor's `agent-trace`** — that aims to be the vendor-independent format for "which lines did which agent write," at file and line level. The complementary OSS tool **`git-ai`** auto-tags Cursor / Claude Code / Copilot output as it's generated and stores AI authorship in git notes that survive rebases and merges, with a "blame-for-AI" command for line-by-line attribution. Tabnine has documented its own provenance/attribution feature for enterprise. For ground-truth attribution without instrumentation, the `Co-Authored-By:` trailer is the de-facto signal: Claude Code emits it by default; OpenAI Codex's behavior is still being clarified (open issue #19799); GitHub Copilot does **not** auto-emit it; VS Code's Copilot Chat tried defaulting it on in early 2026 and rolled back after backlash. So a trailer-based detector will catch Claude Code reliably, miss Copilot inline completions entirely, and partially catch Codex. Statistical detectors (entropy/token-anomaly) exist (Pangram, Decopy, etc.) but their false-positive rate on idiomatic code is not publicly validated and they're not built for line-level streaming attribution. For per-line authorship, `git blame` is canonical; on shallow / treeless / blobless clones the first blame is materially slower (treeless: not recommended; blobless: first run triggers blob download then is fast). A full clone of a moderate repo takes ~4m24s vs ~29.5s shallow — but blame quality on shallow is poor.

**Key numbers.**
- Shallow clone: 29.5s vs full clone: 4m24s (GitHub Blog benchmark).
- Blobless partial clone: blame works correctly but the first run on each path triggers a blob download.
- GitHub REST `/repos/{o}/{r}/commits/{sha}` and `/pulls/{n}/files` each cost 1 token of the 5,000/hr budget — see §C.

**Gotchas.**
- `Co-Authored-By:` is unreliable as ground truth: VS Code shipped it accidentally for non-AI commits in 2026, so the trailer can be present on human-written code. Treat as a strong signal, not a label.
- `agent-trace` is new and not widely supported outside Cursor — relying on it for attribution would lock us to Cursor users.
- Statistical "is this AI?" detectors have unknown FP rates on idiomatic small diffs; not recommended as a primary signal.

**Sources.**
- https://axiomstudio.ai/blog/cursor-agent-trace-explainer
- https://www.blog.brightcoding.dev/2025/12/14/the-ai-code-tracking-revolution-how-to-automatically-identify-ai-generated-code-in-your-git-repositories/
- https://docs.tabnine.com/main/welcome/readme/protection/provenance-and-attribution
- https://www.deployhq.com/blog/how-to-use-git-with-claude-code-understanding-the-co-authored-by-attribution
- https://github.com/openai/codex/issues/19799
- https://windowsforum.com/threads/vs-code-copilot-co-authored-by-default-caused-trust-fallout.416601/
- https://github.blog/open-source/git/get-up-to-speed-with-partial-clone-and-shallow-clone/
- https://github.blog/open-source/git/git-clone-a-data-driven-study-on-cloning-behaviors/

**Confidence.** High that `Co-Authored-By` works for Claude Code; high that it does NOT work for Copilot inline; medium on `agent-trace` adoption trajectory (it's new); high on git blame perf numbers.

---

## C. GitHub API rate limits & feasibility

**Finding.** Pellametric's per-user OAuth token gets **5,000 req/hr**. A GitHub App installation gets **5,000 req/hr** minimum, scaling with repos and users (+50/hr per repo over 20, +50/hr per user over 20), capped at **12,500 req/hr**. Enterprise Cloud installs get a flat **15,000 req/hr**. GraphQL has a separate budget of **5,000 points/hr per user** (10,000 for Enterprise Cloud users), with a hard ceiling of **2,000 points/min secondary limit** and a per-call ceiling of **500,000 nodes** and `first`/`last` capped at 100 per connection. Webhooks are the right primary feed for PR lifecycle: `pull_request` event types (`opened`, `synchronize`, `reopened`, `closed` with `merged:true`) are all delivered with full PR metadata and head/base SHAs; you have to follow up with REST or GraphQL to get the files list because the webhook payload omits the `added/removed/modified` arrays.

**Key numbers — concrete feasibility for a 20-dev org with 200 PRs/30 days:**
- Per PR we need: 1 × `/pulls/{n}` (if not from webhook) + 1 × `/pulls/{n}/files` (paginated, ~1 page for typical PRs <100 files) + 1 × `/pulls/{n}/commits`. Call it **~3 REST calls/PR**.
- 200 PRs × 3 = **600 REST calls / 30d** = ~20 calls/day = trivial against 5,000/hr.
- If we additionally fetch `/commits/{sha}` for every commit on every PR (say 5 commits avg), add **1,000 more calls/30d** = still trivial.
- GraphQL alternative: one query can fetch PR + commits + files + reviewers in **~1–5 points** depending on `first` values. A 200-PR backfill batched 10 PRs/query × ~5 points = ~100 points total. Effectively free.
- Search API has a much stricter limit and we should avoid it — the rate-limit docs flag it as restricted; community discussion #163553 confirms the search endpoint is the first thing teams hit. Don't poll search; subscribe to webhooks.

**Gotchas.**
- The webhook PR payload does NOT include the commit file lists — you must follow up via API. Plan for that 1 extra round-trip per `synchronize` event.
- GraphQL `first`/`last` is 1–100 only. A PR with 500 commits requires pagination.
- Per-installation rate limit on a GitHub App is shared across all of Pellametric's reads on that org's behalf — at 100 orgs × 200 PRs/month the math is still safe (~20k req/month per installation, ~28/hr).

**Sources.**
- https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api
- https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/rate-limits-for-github-apps
- https://docs.github.com/en/graphql/overview/rate-limits-and-query-limits-for-the-graphql-api
- https://docs.github.com/en/webhooks/webhook-events-and-payloads
- https://github.com/orgs/community/discussions/163553

**Confidence.** High. Numbers are from current GitHub docs and the napkin math leaves >100× headroom for our target scale.

---

## D. Materialized views & aggregation in Postgres

**Finding.** Three viable approaches. (1) Native Postgres `REFRESH MATERIALIZED VIEW CONCURRENTLY` — non-blocking reads, but recomputes the full query (cost ∝ source-table size). Fine up to ~tens of millions of rows refreshed every 1–5 min. (2) **pg_ivm** — Incremental View Maintenance via AFTER triggers, only delta is applied, latency is sub-second. The big caveat: pg_ivm is **not available on AWS RDS / Aurora / most managed Postgres** because they restrict extensions. If Pellametric's DB is on Neon / Supabase / Railway-managed-PG we need to verify per-provider. (3) **TimescaleDB continuous aggregates** — purpose-built for time-series, refresh policies with `start_offset / end_offset / schedule_interval`, recommended to exclude the most-recent bucket from refresh because hot buckets churn. TimescaleDB is the strongest natural fit for `session_event` since that table is inherently time-indexed. Industry refresh cadence for "yesterday vs today" engineering dashboards lands in the **15–30 min** range per Timescale's own recommendation; 1–5 min is achievable but burns compute. The fourth option — a plain `summary` table refreshed by a worker — is what Linear/Plausible-style products actually ship in practice because it gives full control over what to recompute and when.

**Key numbers.**
- TimescaleDB continuous aggregates: 15–30 min schedule_interval is the standard sweet spot.
- pg_ivm: immediate (synchronous AFTER trigger), single-digit ms overhead per write.
- `REFRESH MATERIALIZED VIEW CONCURRENTLY`: cost ≈ full query cost; reads not blocked but a second write lock is held briefly at swap time.

**Gotchas.**
- pg_ivm not supported on RDS/Aurora — verify with the actual provider before committing to it.
- `CONCURRENTLY` requires a unique index on the materialized view.
- TimescaleDB locks you into the Timescale extension; migrating off is nontrivial.
- Continuous aggregates with overlapping refresh windows can re-materialize each other's data — known bug surface (Timescale issue #4252).

**Sources.**
- https://github.com/sraoss/pg_ivm
- https://www.postgresql.org/docs/current/sql-refreshmaterializedview.html
- https://pganalyze.com/blog/5mins-postgres-15-beta1-incremental-materialized-views-pg-ivm
- https://docs-dev.timescale.com/docs-howtoreview-config-lana/timescaledb/howtoreview-config-lana/how-to-guides/continuous-aggregates/refresh-policies/
- https://www.tigerdata.com/blog/real-time-analytics-for-time-series-continuous-aggregates
- https://www.epsio.io/blog/postgres-refresh-materialized-view-a-comprehensive-guide

**Confidence.** High on the tradeoffs. Medium on which to actually pick — depends on Pellametric's managed-PG provider, which I don't know from the repo (`postgres-js` + DATABASE_URL is provider-agnostic).

---

## E. Privacy-preserving cohort aggregation

**Finding.** Industry-standard floor is **k ≥ 5**, with **k = 10 or 15** used in higher-sensitivity settings. K-anonymity alone is the cheapest and most useful primitive: simply suppress any cohort row where `count < k`. Layering differential privacy (Laplace noise calibrated to sensitivity = 1 for counting queries) gives mathematically provable guarantees, but the well-known failure mode is that for small groups the noise is the same order of magnitude as the signal — at cohort sizes <10 the DP-protected count is statistically useless. The practical pattern (Apple PFL, NIST guidance, ONS mortality pilot) is **k-anonymity threshold first → DP noise on the surviving cohorts**, never DP-only on tiny groups.

**Key numbers.**
- Minimum recommended k = 3; common production k = 5, 10, or 15 (Immuta, Utrecht handbook).
- Laplace sensitivity for counting queries = 1. So with ε = 1 the noise scale is ~1; a count of 4 returned as 4 ± ~1 is meaningless. Useful regime starts around cohort sizes ≥ 30.
- NIST SP 800-226 has guidance on ε selection for enterprise DP deployments.

**Gotchas.**
- K-anonymity alone is vulnerable to homogeneity attacks (everyone in the cohort has the same sensitive attribute). For Pellametric where the "sensitive attribute" is individual productivity, this is a real risk if a team has 5 members and 4 of them have low scores.
- DP noise destroys ranking among small cohorts — managers will see "team A beat team B" flip across refreshes if you noise the counts naively.
- For Pellametric's cohort views (team vs team within an org), **start with hard k=5 suppression**; defer DP unless we ship a public/cross-org benchmark.

**Sources.**
- https://utrechtuniversity.github.io/dataprivacyhandbook/k-l-t-anonymity.html
- https://www.immuta.com/blog/k-anonymity-everything-you-need-to-know-2021-guide/
- https://pmc.ncbi.nlm.nih.gov/articles/PMC2528029/
- https://www.nist.gov/blogs/cybersecurity-insights/counting-queries-extracting-key-business-metrics-datasets
- https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-226.ipd.pdf
- https://apple.github.io/pfl-research/reference/privacy.html

**Confidence.** High on the k=5 threshold being industry standard. High on DP being overkill for our v1 scope.

---

## F. Dashboard design references

**Finding.** The shared visual language across Linear, Vercel, GitHub, Postman, Supabase is "precise, minimal, technical, dense" — monospace typography, high contrast, no ornamentation, hierarchy and signal over decoration. Linear Insights is the closest analog to what Pellametric is building: a dashboard primitive that supports **charts + metric blocks + tables**, with **dashboard-level filters** that cascade to every widget, and click-through-to-underlying-records from any metric. Swarmia ships crisp DORA dashboards built atop the SPACE framework. DX layered "Core 4" (Speed, Effectiveness, Quality, Impact) over DORA + SPACE + DevEx in April 2026 — this is the current best-in-class taxonomy and worth mirroring in Pellametric's IA. For token-flow attribution specifically, Sankey diagrams are the standard pattern; best practice from interactive-attribution practitioners: **3–4 stages on default view, 8–10 nodes max, drill-down filters for everything else** (otherwise the diagram becomes spaghetti). Sankey is the right pick for "tokens → sessions → PRs → outcomes" but only if we hard-cap the node count.

**Key numbers.**
- Linear dashboards: filters apply globally to every widget; widgets = charts + metric blocks + tables.
- Sankey best practice: cap at 8–10 nodes, 3–4 stages in default view.
- Information density: GitHub/Vercel use dense layouts with monospace fonts; cards are deprecated in favor of tables for power-user views.

**Gotchas.**
- Sankey diagrams scale poorly past ~10 nodes — for a 20-person team they'd already be at the limit.
- Heatmaps work well for team-by-day views; cards work poorly when the user wants to compare across rows. Pellametric should default to tables + sparklines for team views.
- DX Core 4 is the freshest taxonomy (April 2026) — using it gives free credibility with engineering leaders who already know the framework.

**Sources.**
- https://linear.app/insights
- https://linear.app/docs/dashboards
- https://www.swarmia.com/product/engineering-metrics/
- https://getdx.com/dx-core-4/
- https://getdx.com/research/measuring-developer-productivity-with-the-dx-core-4/
- https://peppermint.id/blog/how-vercel-github-and-postman-influence-devtools-design-culture
- https://vercel.com/blog/how-we-made-the-vercel-dashboard-twice-as-fast
- https://www.consult.tv/visualizing-attribution-paths-with-interactive-sankey-diagrams/
- https://datavizproject.com/data-type/sankey-diagram/

**Confidence.** High on design patterns (well-documented). Medium on Sankey being the right choice for our specific token-flow story — it works conceptually but the node-count limit is tight for team-scale data.

---

## Cross-cutting recommendations

1. **Attribution model**: deterministic signals first (branch-name keyword match, cwd→repo, Co-Authored-By trailer, time-window overlap), then add a Jaccard `filesEdited ↔ PR.files` confidence score as a tie-breaker. No public competitor does the Jaccard piece — defensible novelty.
2. **GitHub API**: switch from `/search/issues` (currently used per repo CLAUDE.md) to **webhook-first + GraphQL backfill**. Search API is the tightest budget; webhooks + GraphQL leave >100× headroom.
3. **Storage**: continuous aggregates on TimescaleDB OR a worker-driven `summary` table refreshed every 15 min. Skip pg_ivm unless we control the Postgres host.
4. **Cohort privacy**: hard k=5 suppression in v1. Skip DP until we ship cross-org benchmarks.
5. **AI provenance**: trust `Co-Authored-By` for Claude Code, treat Cursor's `agent-trace` as future-proofing, and accept that Copilot-inline completions will remain invisible without an IDE plugin.
