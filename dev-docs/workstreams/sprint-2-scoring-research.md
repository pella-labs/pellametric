# Sprint-2 Scoring — Research Brief (Presearch v2, Loop 0)

**Scope:** Ground the `packages/scoring` Sprint-2 eval harness design in real-world scoring-system patterns. Output feeds `sprint-2-scoring-plan.md`.
**Method:** Presearch v2 Feature Mode, single Researcher agent (Opus 4.6), web research mandatory.
**Date:** 2026-04-17.

---

## Q1 — How do established developer-productivity metric frameworks validate themselves?

**Finding.** None of the canonical frameworks (SPACE, DORA, DX Core 4, Copilot studies) publish a fixture-based eval harness a third party could run. Validation across the field is **observational** (surveys, telemetry, RCTs) — not synthetic. DORA tier cutoffs are re-clustered yearly on 3k–6k survey responses; DX Core 4's validation is a self-reported-time correlation; Peng et al.'s Copilot paper is an RCT on one HTTP-server task (N=95). The SPACE paper is a position paper explicitly **arguing against** single-metric validation.

**Key sources:**
- SPACE framework — ACM Queue, Forsgren 2021 — https://queue.acm.org/detail.cfm?id=3454124
- DX Core 4 research — 300+ orgs — https://getdx.com/research/measuring-developer-productivity-with-the-dx-core-4/
- DORA 2023 State of DevOps — https://dora.dev/research/2023/dora-report/
- Peng et al. Copilot RCT — arXiv:2302.06590 — https://arxiv.org/abs/2302.06590
- Microsoft/Accenture 2024 Copilot study — https://github.blog/news-insights/research/research-quantifying-github-copilots-impact-in-the-enterprise-with-accenture/

**Gotchas:** DORA tier boundaries drift year-over-year — never bake "elite = X deploys/day" into a fixture. DX validates only against self-report, which over-indexes vs. telemetry. SPACE explicitly warns against the 1-D composite pattern.

**Confidence:** High. The absence of a published fixture is itself the finding.

---

## Q2 — What does a realistic synthetic dev-month fixture record look like?

**Finding.** The closest public artifact is `syncora-ai/Synthetic-AI-Developer-Productivity-Dataset` (5k rows × 10 fields: focus_hours, meetings_per_day, LOC, commits_per_day, task_completion_rate, reported_burnout, debugging_time, tech_stack_complexity, pair_programming, productivity_score). No archetype labels, flat CSV. Across finance/academic analogs (FICO, h-index, MSCI Quality Index), the norm is **log-normal / power-law on count fields, roughly-normal on rates after log-transform**. All composite-score systems surveyed winsorize at p5/p95 and percentile-rank before combining — matching what `ai_leverage_v1` already prescribes.

**Key sources:**
- syncora-ai synthetic dataset — https://github.com/syncora-ai/Synthetic-AI-Developer-Productivity-Dataset
- MSCI Quality Indexes methodology — https://www.msci.com/eqb/methodology/meth_docs/MSCI_Quality_Indexes_Methodology_June_2014.pdf
- Amplitude winsorization docs — https://amplitude.com/docs/feature-experiment/advanced-techniques/winsorization-in-experiment
- Statsig winsorization methodology — https://docs.statsig.com/experiments/statistical-methods/methodologies/winsorization

**Archetype distributions for Bematist** (calibrated to h-scoring-prd §7.1):

| Archetype | Share | `outcomeEvents` | `activeDays` | Subscore profile | Expected `final_ALS` |
|---|---|---|---|---|---|
| low-performer | 15% | 1–3 | 2–5 | efficiency p10–p25, autonomy p10–p20 | 10–25 (heavily confidence-discounted) |
| average | 50% | 8–15 | 10–18 | all subscores p40–p60 | 45–60 |
| high-leverage | 20% | 20–40 | 18–22 | efficiency p80+, autonomy p80+ | 75–90 |
| new-hire | 10% | 2–6 | 8–15 | various | confidence ≈ 0.4–0.7 → discounted |
| regression-case | 5% | (prior-month flip) | — | tests metric-version pin (D13) | — |
| Goodhart-gaming | ≥3 cases | high acceptedEdits, high reverts | — | high raw Efficiency, low `accepted_and_retained` | LOW (per D12 rule 5) |

**Record shape (JSONL, matches wire schema + eval-only fields):**
```json
{
  "dev_id": "dev_001",
  "cohort_id": "cohort_avg",
  "window_start": "2026-03-01",
  "window_end": "2026-03-31",
  "raw_signals": { "outcomeEvents": 12, "activeDays": 15, "acceptedEdits": 87, "revertedEdits": 4, "promotedPlaybooks": 1, "playbookAdoptionByOthers": 2, "cost_usd": 43.50, "sessions": 38 },
  "archetype_tag": "average",
  "expected_final_als": 52,
  "expected_confidence": 1.0
}
```

**Gotchas:**
- Syncora dataset has no archetype tags — do NOT inherit its flat structure.
- Don't draw subscores from a normal distribution — count fields need log-normal; the long tail is load-bearing because winsorize-at-p5/p95 only matters when a tail exists.
- Amplitude explicitly warns against different winsorize cutoffs across cohorts — apply p5/p95 **inside the fixture cohort**, same as prod.
- Stack Overflow's reputation-cap-per-day is a lesson: any subscore uncapped in fixture space will be exploitable in prod — `playbookAdoptionByOthers capped at 10` (D31) already encodes this; mirror in fixture.

**Confidence:** Medium — the syncora/MSCI/Amplitude recipes are concrete, but no public fixture exactly matches our 5-subscore × archetype × confidence-discount shape. We are largely inventing, guided by analog patterns.

---

## Q3 — What eval frameworks exist for metric-scoring regression accuracy?

**Finding.** No industry standard for "MAE ≤ N" thresholds on composite scores exists. Across OpenAI Evals, Anthropic's statistical-evals paper, scikit-learn's own test suite, and the "golden dataset" literature, thresholds are set **empirically against a frozen baseline**: (a) curate a human-labeled golden set → (b) run once to establish baseline MAE → (c) pick a threshold that the baseline passes with margin → (d) gate CI on that snapshot. Anthropic's statistical-evals framing (report SEM + 95% CI, prefer paired-difference tests) is the most rigorous. MAE's robustness to outliers justifies pairing "MAE ≤ 3" with a separate "no outlier > 10" max-absolute-error rule (L∞ norm vs. L1 — different tail-bound guarantees).

**Key sources:**
- Anthropic: A statistical approach to model evaluations — https://www.anthropic.com/research/statistical-approach-to-model-evals
- OpenAI Evals regression cookbook — https://developers.openai.com/cookbook/examples/evaluation/use-cases/regression
- scikit-learn `test_regression.py` — https://github.com/scikit-learn/scikit-learn/blob/main/sklearn/metrics/tests/test_regression.py
- Shaped.ai "Golden Tests in AI" — https://www.shaped.ai/blog/golden-tests-in-ai
- Statsig "Golden Datasets" — https://www.statsig.com/perspectives/golden-datasets-evaluation-standards
- Nature Scientific Reports: Evaluation metrics and statistical tests for ML (2024) — https://www.nature.com/articles/s41598-024-56706-x

**Numbers that matter.** MAE ≤ 3 on 0–100 scale = average prediction within 3 pts. "No outlier > 10" formalizes `max |predicted − expected| ≤ 10` (L∞). Scikit-learn's `decimal=2` convention (~1 pt on 100-pt scale) is tighter; MAE≤3 is appropriately loose for a composite with known synthetic-data noise. With n=500, σ=3 → SEM ≈ 0.13, so MAE=3 vs MAE=4 is distinguishable at high confidence.

**Gotchas:**
- Do **not** set the threshold *before* establishing a baseline. Run the fixture once, measure, add margin. Otherwise you get either flaky CI or silent regressions.
- MAE alone hides **Kendall-tau rank inversion** — include a rank-correlation floor (Kendall τ ≥ 0.7) so reordering high/low performers trips the gate even if absolute errors stay small.
- Operationalize "outlier" as **max |predicted − expected|** per case, not as a statistical outlier of the error distribution (moving target).
- Snapshot tests against raw scoring output are brittle under metric-version bumps (D13) — snapshot the **aggregate stats** (MAE, max-err, τ, per-archetype MAE) and version them alongside `ai_leverage_v1`.
- Don't cross-validate MAE threshold on the same split you tune on — the 100-case held-out split must be frozen before threshold-picking.

**Confidence:** High on "no universal threshold; baseline-empirical is the norm." Medium on whether MAE ≤ 3 is right-sized for `ai_leverage_v1` — pilot run required to confirm.

---

## Synthesis — three recommendations for Bematist

1. **Fixture shape: JSONL, per-dev-month records, 6 explicit archetype tags.** 50 hand-curated cases across {low, average, high-leverage, new-hire, regression-case, Goodhart-gaming}; 450 auto-generated via log-normal sampling on count signals + beta on rates, target ALS computed analytically from locked math. Frozen 100-case held-out split. Record schema mirrors wire schema + `archetype_tag` + `expected_final_als` + `expected_confidence`. Deliberately include cases with `outcomeEvents < 10` / `activeDays < 10` so the confidence discount is genuinely exercised.

2. **Eval thresholds: three gates, not one.** (a) **MAE ≤ 3** on 500-case fixture — headline, already in PRD. (b) **max |error| ≤ 10** per-case — formalize "no outlier > 10" as L∞. (c) **Kendall τ ≥ 0.7** between predicted and expected ranks within each cohort — catches silent rank inversions MAE hides. Report SEM alongside MAE (Anthropic convention). Pilot once, confirm baseline passes with ≥ 1-pt margin, then lock the 3/10/0.7 triple. **Gate (c) is a proposed addition to CLAUDE.md §Testing Rules — requires PRD §10 amendment before adoption.**

3. **Archetype mix + anti-gaming discipline.** Distribution: 15% / 50% / 20% / 10% / 5% / Goodhart. Each archetype ≥ 8 hand-curated cases in the seed. **Publish archetype-stratified MAE in CI output** — a regression in the Goodhart-gaming archetype surfaces even if aggregate MAE stays green. Most load-bearing anti-Goodhart signal we can bake into the harness. Snapshot *aggregate stats* (MAE, max-err, τ, per-archetype MAE) in a versioned file `eval-snapshot.ai_leverage_v1.json`; any `packages/scoring` change that moves these stats forces a bump to `v2` (D13), preventing silent redefinition.

---

## What this brief did NOT find

- No prior art for a versioned, CI-gated eval fixture on a **composite** developer-productivity score. We're first. That means we own the methodology choices and should document them loudly.
- No off-the-shelf library that bundles MAE + L∞ + Kendall τ + archetype stratification. We'll write a ~200-line runner ourselves on top of `bun test`.

*Gaps to revisit in Loop 6 if scope expands:* integration with `task_category` enum (Sebastian's F-enum, not landed) and cohort-normalization edge cases with n < 5 (k-anon floor).
