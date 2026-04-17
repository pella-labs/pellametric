# D2-07 Primer: Twin Finder (live similar-workflow lookup)

**Workstream:** H-AI · **Date:** 2026-04-17 · **Contract:** `dev-docs/PRD.md` §D31 + §5.1 · **Blocked by:** D2-01, D2-05, D2-06, D1-02

## Goal

Given an IC's current session abstract, find the top-k most similar past sessions across the org (cosine similarity against `prompt_clusters.centroid` + KNN over `cluster_assignment_mv`). Surfaces the "similar workflow found" hint on `/me` and powers the Team Impact adoption signal for D31 playbooks.

## Deliverables

- [ ] `packages/api/src/routers/twinFinder.ts` — tRPC procedure `twinFinder.similar`: takes `(engineer_id, session_id, k)` → returns top-k similar sessions with playbook flags.
- [ ] `packages/scoring/src/similarity.ts` — cosine similarity helper (pure math).
- [ ] `apps/ingest/src/routes/twinFinder.ts` — internal HTTP handler that the tRPC procedure calls (live embed → nearest-cluster lookup → top-k sessions).
- [ ] Live embed path uses `EmbedProvider.embed()` via the D2-05 cache wrapper.
- [ ] k-anonymity floor: if top-k bucket has fewer than 3 contributing engineers, return "cohort too small" instead of surfacing names.
- [ ] `__tests__/twinFinder.test.ts` — seed 10 sessions in 3 clusters; target session matches its own cluster's top-k.

## Invariants

- Live latency target: p95 < 300 ms (contract 07 §Performance gates — dashboard p95 < 2s, Twin Finder a subset).
- Cache-first via D2-05.
- IC names hidden by default (color dots or engineer_id_hash); reveal requires opt-in per contract 07 §Reveal gesture.
- Never returns sessions from other orgs (RLS on PG + `org_id` prefix on CH query).

## Tests

- Similar session returns top-k from the same cluster.
- Cross-tenant probe: org A's Twin Finder never returns org B rows.
- Cold cluster (< 3 engineers): returns "cohort too small" error.
- p95 latency under fixture load ≤ 300 ms.

## Branch / PR

```bash
git switch -c D2-07-twin-finder-jorge
# after D2-01, D2-05, D2-06, D1-02 all merged
git push -u origin D2-07-twin-finder-jorge
gh pr create --base main --title "feat(api): Twin Finder — live similar-workflow lookup (D2-07)"
```

## Time estimate

~5–6 h.

## After this ticket

- Workstream E wires the `/me` surface to this procedure.
- D31 Team Impact signals (`playbookAdoptionByOthers`) populate from this data.
