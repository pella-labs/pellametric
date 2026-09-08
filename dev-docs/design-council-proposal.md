# Pellametric — Design Council Proposal (presearch2, Loop 2/Design)

> Output of the Design Council (Opus 4.6). Debate-driven design for both manager and dev audiences. Recommends evolving the bematist palette while adopting denser layouts, AI-source brand colors, and split route trees.

## 0. Council positions

- **Architect:** Evolve the bematist palette, split manager and dev into separate route trees.
- **Challenger:** Push toward Linear/DX/Swarmia density; stronger AI-source color system.
- **Researcher:** Confidence + k-anonymity + cold-start affordances must come *before* aesthetics.

**Recommendation:** Evolve the palette, commit to a bolder layout posture — split routes, denser tables, a dedicated AI-source brand layer (Claude / Codex / Cursor / human), Sankey-as-hero on the dev view.

---

## 1. Information Architecture

### 1.1 Current state problem

`/org/[provider]/[slug]` mounts `OrgViewSwitcher` with a Team/Myself tab. Manager and dev land on the same URL with a client-side toggle. Hides dev view from URL history, no shareable `/me` link, forces shared loading boundary, deep links broken.

### 1.2 Manager route tree

```
/org/[provider]/[slug]/
├── (overview)/                    # default landing
│   └── page.tsx                   # "Did we spend well?" snapshot
├── prs/
│   ├── page.tsx                   # PR list (cost-per-PR table)
│   └── [number]/page.tsx          # PR detail w/ attribution bar
├── devs/
│   ├── page.tsx                   # per-dev leaderboard
│   └── [login]/page.tsx           # drill-in
├── waste/page.tsx
├── intent/page.tsx
├── benchmark/page.tsx              # cohort, k-anon gate
├── members/                       # existing
├── invite/                        # existing
└── policy/                        # existing
```

### 1.3 Dev route tree

```
/me/[provider]/[slug]/
├── (overview)/page.tsx            # personal lineage feed
├── sessions/
│   ├── page.tsx
│   └── [id]/page.tsx              # session detail w/ prompts (self-decrypt)
├── prs/page.tsx                   # MY merged PRs w/ attribution
├── efficiency/page.tsx
└── waste/page.tsx
```

The `/me/...` namespace keeps the dev's URL space distinct, makes prompt-decrypt gate live at a layout boundary instead of per-component.

### 1.4 Shared components

```
apps/web/components/
├── shell/{nav-rail, breadcrumb, confidence-badge, k-anon-gate}.tsx
├── data/{data-table, stat-card, source-bar, source-chip, sankey,
│         scatter-quadrant, calendar-heatmap, sparkline}.tsx
└── ui/                             # existing shadcn primitives stay
```

### 1.5 IA debate resolution

Auth model already enforces "only the owning user decrypts prompts." That gate is cleaner at a route segment than as a query-param branch. **Split wins.**

---

## 2. Key views — ASCII mockups (78 cols)

### 2.1 Manager Overview — "Did we spend well last week?"

```
+----------------------------------------------------------------------------+
| pellametric  pella-labs/ ▾                       Walid ▾   Wk 19  ◀ Apr 28 ▶|
+----------------------------------------------------------------------------+
| OVERVIEW · PRs · DEVS · WASTE · INTENT · BENCHMARK · MEMBERS · POLICY      |
+============================================================================+
|  COST PER MERGED PR        TEAM SPEND          MERGED PRs       WASTE      |
|  $ 4.21  ▼ 12% wk          $ 187.40  ▲ 3%      44  ▲ 9%         18.6%  ▲   |
|  ████▄▆▆▅▇█▆▅▅▇             ▄▄▆▆▇▇▇▆▆▇▇▆▆       ▂▄▄▆▆▇▇▆▆▆▆     ▇▆▇▅▅▄▄▄  |
|  Confidence: 81% sessions matched to PRs   [details]                       |
+----------------------------------------------------------------------------+
|  SPEND vs THROUGHPUT (per dev, last 7d)              ☐ size = sessions     |
|   merged PRs  ▲                                                            |
|         12 ─┤                  ○ jess                                      |
|         10 ─┤        ○ omar                                                |
|          8 ─┤   ○ kai                  ○ priya                             |
|          6 ─┤            ○ leo                       ○ alex                |
|          4 ─┤    ○ noor          ○ dana                                    |
|          2 ─┤────────────────────────────────────────  median ─ ─ ─        |
|              0    25    50    75    100   125   150   $ spent             |
|  Hover row → drill-in.  Outliers labelled.   sort ▾  filter ▾              |
+----------------------------------------------------------------------------+
|  ATTRIBUTION MIX (this week, across merged PRs)                            |
|  ████████████████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░    |
|  Claude 41%   Codex 22%   Cursor 14%   Human 23%                           |
+============================================================================+
```

### 2.2 Cost-per-PR table

```
| # PR  TITLE                       AUTHOR   COST    SRC MIX        CONF TTM |
|-----  ----------------------------  -------  ------  ---------------  ----  --|
| #142 feat(web): ttl management     jess    $11.20  ▓▓▓▓▒▒░░░░░░░    ███  9h |
| #138 feat(web): orgactions menu    kai     $ 8.04  ▓▓▓▒▒▒▒░░░░░░    ██▒  4h |
| ...                                                                        |
| ▓ Claude  ▒ Codex  ░ Cursor  · Human       CONF: █ high ▒ med ░ low       |
```

Sortable every column. Sticky header. Confidence = 3-pip indicator (color-blind safe).

### 2.3 PR Detail

```
| #142  feat(web): implement prompt retention management                     |
|         author: jess   merged 2026-05-09  TTM 9h 14m   reverts: 0          |
+----------------------------------------------------------------------------+
|  TOTAL COST              SESSIONS LINKED       LOC NET       REVIEWS       |
|  $ 11.20                 7  (5 high · 2 med)   +642 / -118   2 cycles      |
+----------------------------------------------------------------------------+
|  CODE-OUTPUT ATTRIBUTION                                                   |
|  Claude  48%  ◼ ◼ ◼ ◼ ◼     |   tokens-out: 184k                          |
|  Codex   12%  ◼              |   tokens-out:  46k                          |
|  Cursor  18%  ◼ ◼            |   edits:      31                           |
|  Human   22%  ◼ ◼ ◼          |   lines:     142                           |
|  Attribution confidence: HIGH (5/7 sessions w/ cwd→repo match)             |
+----------------------------------------------------------------------------+
|  LINKED SESSIONS                                                 [timeline]|
|  May 8  09:12  claude  build feature       45m   $2.10  ◼◼◼◼◼  HIGH       |
|  ...                                                                       |
```

Managers cannot click a session row to see prompts — that's gated. Click reveals outcome metadata only (intent, files touched count, errors, teacher moments).

### 2.4 Dev Overview — personal lineage feed (Sankey hero)

```
|  SESSION → COMMIT → PR  (last 14d)                          [Sankey ▾]    |
|   sessions                commits                         PRs              |
|   build  ┐                                                                 |
|   ──────┼─── ──┐         ┌── 9 commits ──────────┬─── #142  ✓ merged      |
|   debug  │     ├─────────┤                       │                         |
|   ──────┘     │          └── 3 commits ─────────┐│                         |
|   refactor    │                                  └─ #138  ✓ merged        |
|   ────────────┘                                                            |
|   test                  ┌── 1 commit ────────────── #145  ◌ open          |
|   ────────  ────────────┤                                                  |
|   explore   (no commit  └──── (dropped) ─────────── (no PR)               |
|              attached)                                                     |
```

Sankey is the dev-side hero — answers "where did my tokens go?" in one glance.

### 2.5 Dev Session Detail (with prompts)

```
| source: claude    intent: build feature    started: May 8 09:12   45m     |
| tokens in: 18.2k   out: 9.4k   cache R/W: 8.1k / 1.2k   cost: $2.10       |
+----------------------------------------------------------------------------+
|  LINKED PR     #142 feat(web): prompt retention   merged 2026-05-09 ✓     |
|  CONFIDENCE    HIGH — cwd → owner/name → branch match                      |
+----------------------------------------------------------------------------+
|  FILES TOUCHED                              PROMPTS  (decrypted client)   |
|  apps/web/app/api/retention/route.ts  +94   ┌──────────────────────────┐  |
|  ...                                        │ 09:12  Help me design ...│  |
|  TOTAL  +642 / -118 across 11 files         └──────────────────────────┘  |
```

**Decrypt prompts** button only renders for owning user. Plaintext decrypted in browser using user's wrapped DEK fetched from `/api/me/prompt-key`. Server never sees plaintext.

### 2.6 Cohort Benchmark

```
| Cohorts with n<5 are hidden. Showing 6 of 11 segments.                    |
|                  YOUR ORG     COHORT P50    COHORT P10    n               |
| Cost/merged PR    $ 4.21       $ 5.80        $ 2.10        12 orgs ✓     |
| Tokens/PR         84k          108k          41k           12 orgs ✓     |
| Stuck > 24h       4%           ─             ─             n=3 hidden    |
```

Hidden rows shown with grey `─` cells + footer line. No silent dropout.

### 2.7 Waste view

```
| STUCK SESSIONS     ABANDONED WORK     TOP SINKS (tokens, no PR)            |
| 12   ▲ 3 wk        4   ─              184k  explore react-flow  (alex)    |
+----------------------------------------------------------------------------+
| alex   May 7 14:22  claude  explore        4h 12m  $4.40   no commit ⚠   |
| kai    May 8 09:01  codex   debug          2h 18m  $1.90   1 commit, no PR|
```

Suggested action: review w/ dev · archive · re-link to existing PR.

### 2.8 Intent × Outcome correlation

```
|   intent       sessions   merged-PR rate    avg cost   median TTM         |
|   build         142       78% ███████▒░░    $ 3.20      6h                |
|   debug          88       54% █████▒░░░░    $ 1.84      9h                |
|   explore        61       18% ██░░░░░░░░    $ 4.90     ──                 |
|
|   Heatmap by day-of-week × intent (merge rate):                            |
|             Mon  Tue  Wed  Thu  Fri  Sat  Sun                              |
|   build     ▓▓▓  ▓▓▓  ▓▓▓  ▓▓▒  ▓▓▒  ▒░░  ░░░                            |
|
|   Insight: explore sessions on Fridays show 4% merge rate. Consider …    |
```

Server-side rule callout (not LLM by default — keep deterministic).

---

## 3. Component & token strategy

### 3.1 Color tokens — extend

```css
/* apps/web/app/globals.css */
--source-claude:  #c08a4f;   /* warm tan */
--source-codex:   #6fa3b8;   /* slate-blue */
--source-cursor:  #b07ec0;   /* muted violet */
--source-human:   #8a8a82;   /* taupe */

--conf-high:      var(--positive);
--conf-med:       var(--warning);
--conf-low:       #6c6c66;

--chart-grid:     rgba(237, 232, 222, 0.06);
--chart-axis:     rgba(237, 232, 222, 0.24);
```

Tailwind v4 canonical: `bg-(--source-claude)`, `bg-linear-to-r from-(--source-claude) to-(--source-codex)`. NEVER `bg-[var(...)]`.

### 3.2 Color-blind safety

Hex pairs chosen so deutan/protan distance >25 in CIEDE2000, tritan >18:

| source  | hex     | pip | glyph |
|---------|---------|-----|-------|
| claude  | #c08a4f | ◼   | C     |
| codex   | #6fa3b8 | ▨   | X     |
| cursor  | #b07ec0 | ▦   | R     |
| human   | #8a8a82 | ◻   | H     |

Both hue AND shape pip must render — never color alone.

### 3.3 Typography

Add two classes on top of existing `mk-*`:

```css
.mk-stat-numeric { /* KPI tiles */
  font-family: var(--font-numeric);
  font-variant-numeric: tabular-nums;
  font-size: clamp(32px, 3.6vw, 48px);
  letter-spacing: -0.03em; line-height: 1;
}
.mk-table-cell { /* dense table rows */
  font-family: var(--font-mono);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0; line-height: 1.4;
}
```

`tabular-nums` everywhere a number renders. Mono for tables only (not body) — buys 30% more rows per viewport.

### 3.4 Spacing rhythm

- **Dense** (tables, charts): `p-2 gap-2`, row height `h-9` (36px).
- **Standard** (cards, panels): `p-6 gap-6` — current default.
- **Hero** (KPI strip): `p-8 gap-8`.

### 3.5 Chart library

| Library | Bundle (gz) | Sankey | Heatmap | Tree-shake | SSR | Verdict |
|---|---|---|---|---|---|---|
| Recharts | ~95 KB | No | No | Poor | OK | Wall on Sankey |
| nivo | ~110 KB+ | Yes | Yes | Per-chart | OK | Theming fights bematist |
| **Visx** | **~30-60 KB** | **Yes** | **Yes** | **Excellent** | **Excellent** | **LOCKED** |
| Plain D3 | ~50 KB core | Plugin | Plugin | Excellent | Tricky | Most cost |
| SVG only | 0 KB | Manual | Manual | — | Trivial | Sparklines only |

**LOCKED: Visx for 4 heroes (Sankey, scatter, calendar heatmap, source-attribution bar) + plain inline SVG for sparklines and source pip glyphs.**

### 3.6 Chart patterns

- **Sankey**: `@visx/sankey`. Band color = source. Width = tokensOut. Hover dims non-traversed bands to 20% opacity. Click PR node → PR detail.
- **Heatmap**: custom Visx grid. Cell `h-4 w-4`, 1px gap. 5-stop ramp `--muted` → `--accent`.
- **Scatter**: `@visx/xychart`. Median dashed. Dot radius = sqrt(sessions). Label only outliers |z|>1.5.
- **Stacked bar (attribution)**: plain SVG, 4 `<rect>`. Server-pre-computed.
- **Sparkline**: plain inline SVG path, `w-20 h-4`. Glyph, not chart.

---

## 4. Direction debate — Evolve vs Bolder

### 4.1 Evolve case

- Warm dark canvas distinct vs GitHub-blue/Linear-violet. Throwing it away = regression.
- Mono `mk-eyebrow` / `mk-label` already reads as instrument panel.
- Sage `--primary` ties to "growth/shipped" semantically.
- `mk-card` restraint ages well.

### 4.2 Bolder case

References: Linear density, Swarmia PR joins, DX velocity-effort, GitHub Insights contributor, Vercel KPI strips.

- Card-grid → panel grids with shared borders. Density doubles.
- Left nav rail instead of top tabs.
- Two-row hero strip on every overview.
- AI-source brand colors as first-class language.

### 4.3 Recommendation

**Evolve palette, adopt bolder layout posture:**

1. **Keep** bematist tokens (`--background`, `--card`, `--primary` sage, `--warning` amber) — the brand.
2. **Add** four `--source-*` tokens — non-negotiable.
3. **Replace** Team/Myself client tab with split routes (`/org/...` vs `/me/...`). Each gets nav rail.
4. **Move** to dense panel grids with shared borders on data pages. Keep card aesthetic on marketing/settings/onboarding.
5. **Commit** to Visx + inline SVG; each route's chart code under ~60 KB.

---

## 5. Motion & micro-interactions

### 5.1 Where motion helps

- Filter changes (Sankey, scatter): 220ms `cubic-bezier(0.2,0,0,1)`.
- Drill-in: shared-element transition on PR number badge, 180ms.
- Hover-lift: 1px border color change only. No translate-y, no shadow.
- Lineage hover: dim non-traversed Sankey bands 20%, 120ms.
- "Decrypt prompts": 200ms fade-in.

### 5.2 Banned

- Row enter/leave animations on data tables.
- KPI tile flips/spins.
- Page-load skeleton-to-content fade — skeletons must match loaded geometry, transition invisible.
- Tab indicator slide — replaced by nav rail `border-l-2 border-(--primary)`.
- Chart entry animations >250ms.

### 5.3 Reduced motion

All motion gated by `@media (prefers-reduced-motion: no-preference)`. Default = no motion.

---

## 6. Accessibility & data-quality

### 6.1 Confidence affordances

1. **Per-row pip**: `███`/`██▒`/`█▒░`. Pip count is accessibility carrier; color reinforces.
2. **Page-level banner** on PR detail when overall confidence <70%: warning strip *above* attribution bar.
3. **Explainer modal**: plain-English algorithm walkthrough.

Never silently drop low-confidence data — gray it down and label it.

### 6.2 Non-color encoding (every chart)

| chart | non-color channel |
|---|---|
| stacked attribution | inline text labels |
| Sankey | band thickness + label |
| scatter | dot shape per source |
| heatmap | numeric label on hover |
| source pip | glyph (◼ ▨ ▦ ◻) |

### 6.3 Empty states

Manager cold-start:

```
|  Nothing to attribute yet.                                                  |
|  4 devs joined.  2 have installed the collector.  0 sessions have matched   |
|  a merged PR in the last 7 days.                                            |
|                                                                            |
|  Common causes:                                                            |
|   ◯  Collectors not yet running                       [view setup]        |
|   ◯  Sessions are linked to repos outside this org    [review filter]     |
|   ◯  No PRs merged this week                                              |
|                                                                            |
|  Show me anyway:  [Unmatched sessions]  [All PRs (no attribution)]        |
```

Three diagnostics, two escape hatches. No illustration, no exclamation marks.

### 6.4 Loading skeletons

1. Skeleton matches loaded geometry — reserve exact row height/column widths.
2. Stream local first. Attribution + sessions render from DB instantly. GitHub-derived strip (reviews, reverts) renders into own row with skeleton. Failure → "data unavailable" + retry; rest of page stays alive.

### 6.5 Keyboard nav

- `g o` Overview, `g p` PRs, `g d` Devs, `g w` Waste (Linear-style chord, scoped per audience).
- `?` keymap modal.
- Table rows: arrow keys + Enter/Esc.
- Sankey: Tab walks nodes, Enter filters to band.

---

## 7. Ship-first consensus

If only one route's worth of polish before demo:

1. `/org/.../(overview)` + `/org/.../prs` + `/org/.../prs/[number]` — proves cost-per-PR.
2. `/me/.../(overview)` with Sankey — proves traceability.
3. Everything else (waste/intent/benchmark/dev session detail) behind those.

Foundational (must land before any view): split routes, `--source-*` tokens, confidence-pip pattern, Visx adoption.

---

## Files most impacted

- `apps/web/app/globals.css` — add `--source-*`, `--conf-*` tokens; `.mk-stat-numeric`, `.mk-table-cell`.
- `apps/web/app/org/[provider]/[slug]/page.tsx` — restructure under `(overview)`, add siblings `prs`, `prs/[number]`, `devs`, `devs/[login]`, `waste`, `intent`, `benchmark`.
- `apps/web/components/org-view-switcher.tsx` — delete (replaced by route split).
- `apps/web/components/team-tables.tsx` — convert to `components/data/data-table.tsx`.
- New tree `apps/web/app/me/[provider]/[slug]/...` for dev namespace.
