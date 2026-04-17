# D2-04 Primer: LLM-judge adversarial eval harness

**Workstream:** H-AI · **Date:** 2026-04-17 · **Contract:** CLAUDE.md "Testing Rules" + PRD §8.3 · **No D1 blockers**

## Goal

`packages/scoring/src/eval/` — 50 synthetic team-week adversarial scenarios that stress the Insight Engine (D2-02) against Goodhart-trap cases. LLM-judge (Opus 4.x) scores each output; gate is MAE ≥ 0.7 (i.e., model agreement with hand-curated expected-severity labels).

## Deliverables

- [ ] `packages/scoring/src/eval/scenarios.ts` — 50 `AdversarialScenario` records: `{id, description, fixtures, expected_label}`. Include Goodhart traps: "high-token dev resolves all infra incidents → must NOT be marked inefficient"; "low-token dev writes only trivial code → must NOT be marked as 'high efficiency'".
- [ ] `packages/scoring/src/eval/judge.ts` — Opus judge call: prompt gets scenario description + pipeline output + expected label; returns `"pass" | "fail" | "ambiguous"` with reasoning.
- [ ] `packages/scoring/src/eval/run.ts` — runner: for each scenario, invoke pipeline stub (mock until D2-02), collect judge verdicts, compute MAE.
- [ ] `packages/scoring/src/eval/cli.ts` — wired to `bun run test:eval` script.
- [ ] `__tests__/eval.test.ts` — smoke test: 3 trivial scenarios, judge stub returns fixed answers, MAE computed correctly.
- [ ] Root `package.json` — add `"test:eval": "bun --env-file=.env --filter='@bematist/scoring' test:eval"`.

## Invariants

- **MAE ≥ 0.7 merge-blocking** on any change to `packages/scoring/` or `apps/worker/src/jobs/insight/` (CI rule).
- Judge model is Opus 4.x (highest capability); Haiku runs the engine under eval. Different models = less self-agreement bias.
- Scenarios include at least 10 high-impact / high-cost / resolved-incidents cases the engine MUST NOT misclassify as inefficient.
- Deterministic scenario IDs; no randomness in the fixture corpus.

## Tests

- Smoke with 3 trivial scenarios + mock judge verifies runner math.
- Adversarial gate: full 50 scenarios + real Opus judge — run in CI only on `packages/scoring/**` or `apps/worker/src/jobs/insight/**` changes (label gate). ~$1–2 per run at Opus prices; caches judge responses keyed on `(scenario_id, pipeline_output_hash)`.

## Branch / PR

```bash
git switch -c D2-04-llm-judge-eval-jorge
git push -u origin D2-04-llm-judge-eval-jorge
gh pr create --base main --title "feat(eval): LLM-judge adversarial harness (MAE ≥ 0.7) (D2-04)"
```

## Time estimate

~6–8 h. Writing the 50 Goodhart-trap scenarios is the slow part.

## After this ticket

- D2-02 pipeline changes trigger this gate.
- Any future scoring change (`_v2`, `_v3`) also gated.
