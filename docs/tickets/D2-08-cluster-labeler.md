# D2-08 Primer: Gateway cluster labeler (3–5 word labels)

**Workstream:** H-AI · **Date:** 2026-04-17 · **Contract:** CLAUDE.md "AI Rules" · **Blocked by:** D2-06 (cluster centroids)

## Goal

Given a cluster's representative abstracts (already redacted + Clio-verified), generate a 3–5 word human-readable label via a single Haiku 4.5 call. Regex-validated: no URLs, no proper nouns, no engineer identity. Writes to `prompt_clusters.label`.

## Deliverables

- [ ] `apps/worker/src/jobs/cluster/label.ts` — already stubbed in D2-06; this ticket fills in the real Haiku call.
- [ ] `apps/worker/src/jobs/cluster/label_validate.ts` — regex pipeline: rejects URLs, emails, proper-name tokens (simple heuristic: any ≥ 5-char token that's not in a stop-word list), and >5-word labels. Returns `null` on fail; caller retries once with stricter prompt, else stores label as `null`.
- [ ] Prompt template in `apps/worker/src/jobs/cluster/prompts/label.md` — instructs Haiku to emit exactly `{label: "three to five words"}` JSON.
- [ ] `__tests__/label.test.ts` — mocked Haiku: valid 4-word label passes; URL-containing label rejected; proper-noun rejected; retry path.

## Invariants (CLAUDE.md AI Rules)

- **Only outbound LLM call from the gateway** — inputs already redacted + Clio-verified non-identifying.
- Regex validator blocks URLs / proper nouns.
- No engineer identity attached to the call.
- Failure → `label=null`, cluster is still usable (dashboard falls back to `cluster_<short_id>`).
- Haiku 4.5 + prompt caching.

## Tests

- Mocked Haiku with fixture completions:
  - `{"label": "refactor api routes"}` → accepted.
  - `{"label": "talked with Sarah about auth"}` → rejected (proper noun).
  - `{"label": "see https://docs.example.com"}` → rejected (URL).
  - `{"label": "this is way too many words for a label"}` → rejected (> 5 words).

## Branch / PR

```bash
git switch -c D2-08-cluster-labeler-jorge
# after D2-06 merged
git push -u origin D2-08-cluster-labeler-jorge
gh pr create --base main --title "feat(worker): gateway cluster labeler (Haiku 4.5 + regex gate) (D2-08)"
```

## Time estimate

~3–4 h.

## After this ticket

- Sprint 2 closes. All H-AI tickets shipped.
- M1 checkpoint gates run end-to-end (scoring eval + privacy adversarial + perf p95 <2s).
