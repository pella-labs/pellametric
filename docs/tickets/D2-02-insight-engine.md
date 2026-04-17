# D2-02 Primer: Insight Engine skeleton (H4a–H4f decomposed pipeline)

**Workstream:** H-AI · **Date:** 2026-04-17 · **Contract:** `dev-docs/PRD.md` §8.3 · **No D1 blockers**

## Goal

`apps/worker/src/jobs/insight/` — decomposed 6-call pipeline producing manager-facing insights. Per CLAUDE.md AI Rules: SQL pre-compute with ID enum grounding (no hallucinated UUIDs) → 4 separate Haiku 4.5 calls (constrained ID enums per call) → self-check pass → high-confidence gate (only High shown; Med labeled "investigate"; Low dropped).

## Deliverables

- [ ] `h4a_precompute.ts` — SQL aggregates against MVs (`dev_daily_rollup`, `team_weekly_rollup`, etc.) returning valid-ID enums. No LLM. Stub returns deterministic fixture enums until D1-02 lands in main.
- [ ] `h4b_outlier.ts` — Haiku 4.5 call #1: "spot the high-cost, low-outcome outliers". Inputs grounded on H4a enums.
- [ ] `h4c_cohort.ts` — Haiku 4.5 call #2: "identify cohort-level patterns".
- [ ] `h4d_trend.ts` — Haiku 4.5 call #3: "weekly-delta narrative".
- [ ] `h4e_playbook.ts` — Haiku 4.5 call #4: "surface recent Promote-to-Playbook candidates".
- [ ] `h4f_self_check.ts` — verify every cited `session_id` / `cluster_id` / `dev_id` came from the enum. Regenerate failing calls once; drop if still failing.
- [ ] `pipeline.ts` — orchestrator; applies High-confidence gate at the end.
- [ ] `prompts/` — four prompt templates, each with `<user_data>...</user_data>` prompt-injection envelope.
- [ ] `__tests__/pipeline.test.ts` — adversarial 50-case eval (`test:scoring`-adjacent gate ≥ 0.7).

## Invariants (CLAUDE.md AI Rules)

- ID enum grounding on EVERY cited ID. Validator catches hallucinations.
- Prompt-cached (Anthropic `prompt_caching: { type: "ephemeral" }`).
- No second-order LLM per session (D10). This is aggregate-only.
- Haiku 4.5 default model (`claude-haiku-4-5-20251001`). BYO `ANTHROPIC_API_KEY`.
- Insight confidence filter server-side per contract 07 invariant 5.

## Scope cap

Skeleton only. Real data flow wires up when D1-02 MVs + D2-05 embedding cache are in main. For this PR: stub H4a, wire H4b–H4f as real Haiku calls against a fixture, eval gate passes at 0.7.

## Tests

- Happy path: 1 synthetic week → 1 High insight.
- Hallucination path: self-check catches fake UUID and regenerates.
- Confidence gate: Med labeled "investigate", Low dropped.
- Adversarial: 50 synthetic team-weeks; LLM-judge MAE ≥ 0.7.
- Model selection: cheap model used for mechanical steps (H4a, H4f), standard for judgment (H4b–H4e).

## Branch / PR

```bash
git switch -c D2-02-insight-engine-jorge
# implement pipeline + tests
bun run test:scoring   # the 50-case gate
git push -u origin D2-02-insight-engine-jorge
gh pr create --base main --title "feat(insight): 6-call Haiku pipeline skeleton + adversarial eval (D2-02)"
```

## Time estimate

~8–10 h including eval harness setup.

## After this ticket

- Real data plumbing lands when #14 (D1-02 MVs) merges to main.
- D2-04 (LLM-judge eval) extends the adversarial cases.
