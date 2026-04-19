import { assertRole, type Ctx } from "../../auth";
import type { TrackingPreviewOutput, TrackingPreviewParsed } from "../../schemas/github/tracking";

/**
 * PRD §14 — `GET /api/admin/github/tracking-preview`.
 *
 * Dry-run: given a hypothetical `(mode, included_repos)` pair, compute how
 * many sessions would flip eligibility vs the current `session_repo_eligibility`
 * snapshot. No writes, no audit_log row. Admin-only.
 *
 * Projection math:
 *   - Build the "would-be-tracked" set of `(provider_repo_id, effective)`.
 *   - Join `session_repo_links` (repo_id_hash) → `repos` (provider_repo_id).
 *     For each session we compute effective eligibility under the projection.
 *   - Compare to the current `session_repo_eligibility.eligible` bit.
 *
 * The computation uses per-session aggregation in Postgres — we never
 * materialize the full cross product. Tenant-scoped via `WHERE tenant_id = $1`.
 */
export async function getTrackingPreview(
  ctx: Ctx,
  input: TrackingPreviewParsed,
): Promise<TrackingPreviewOutput> {
  assertRole(ctx, ["admin"]);

  // Build the projection: which provider_repo_ids would be "effectively tracked"?
  //   - Start from `repos` with current tracking_state
  //   - Override "inherit" rows by the proposed mode
  //   - Override by the `included_repos` parameter (semantics per schema doc)
  //
  // Semantics (per schema doc):
  //   mode='selected' + included_repos = explicit allow-list (additive to already-'included')
  //   mode='all'      + included_repos = explicit deny-list  (additive to already-'excluded')
  //
  // We compute per-repo effective bit in SQL so we don't paginate thousands of
  // repos into Node.

  const repoRows = await ctx.db.pg.query<{
    provider_repo_id: string | null;
    tracking_state: string;
  }>(
    `SELECT provider_repo_id, tracking_state
       FROM repos
      WHERE org_id = $1
        AND provider = 'github'
        AND deleted_at IS NULL
        AND provider_repo_id IS NOT NULL`,
    [ctx.tenant_id],
  );

  const override = new Set(input.included_repos);
  const tracked = new Set<string>();
  for (const r of repoRows) {
    if (!r.provider_repo_id) continue;
    const st = normalizeState(r.tracking_state);
    const overridden = override.has(r.provider_repo_id);

    let wouldTrack: boolean;
    if (st === "included") wouldTrack = true;
    else if (st === "excluded") wouldTrack = false;
    else if (input.mode === "selected") {
      // In selected-mode, 'inherit' defaults to not-tracked; included_repos
      // adds it in.
      wouldTrack = overridden;
    } else {
      // In all-mode, 'inherit' defaults to tracked; included_repos here means
      // "explicit deny" (will become excluded).
      wouldTrack = !overridden;
    }
    if (wouldTrack) tracked.add(r.provider_repo_id);
  }

  // Current eligibility snapshot — tenant scoped. We need (session_id,
  // eligible) and the set of provider_repo_ids each session links to.
  //
  // Query: per session, aggregate the set of provider_repo_ids (via
  // `session_repo_links.provider_repo_id`) + current eligibility.
  const sessionRows = await ctx.db.pg.query<{
    session_id: string;
    current_eligible: boolean;
    provider_repo_ids: string[] | null;
  }>(
    `SELECT sre.session_id::text AS session_id,
            sre.eligible AS current_eligible,
            array_agg(DISTINCT srl.provider_repo_id) FILTER (WHERE srl.provider_repo_id IS NOT NULL)
              AS provider_repo_ids
       FROM session_repo_eligibility sre
       LEFT JOIN session_repo_links srl
              ON srl.tenant_id = sre.tenant_id
             AND srl.session_id = sre.session_id
      WHERE sre.tenant_id = $1
      GROUP BY sre.session_id, sre.eligible`,
    [ctx.tenant_id],
  );

  let wouldBecomeEligible = 0;
  let wouldBecomeIneligible = 0;
  const sampleEligible: string[] = [];
  const sampleIneligible: string[] = [];

  for (const s of sessionRows) {
    const repos = s.provider_repo_ids ?? [];
    // Session would be eligible iff ANY of its linked repos is in the
    // projected tracked set. (Matches current eligibility invariant:
    // session is eligible if any linked repo is tracked.)
    const projectedEligible = repos.some((r) => tracked.has(r));
    if (projectedEligible && !s.current_eligible) {
      wouldBecomeEligible++;
      if (sampleEligible.length < 10) sampleEligible.push(s.session_id);
    } else if (!projectedEligible && s.current_eligible) {
      wouldBecomeIneligible++;
      if (sampleIneligible.length < 10) sampleIneligible.push(s.session_id);
    }
  }

  return {
    sessions_that_would_become_eligible: wouldBecomeEligible,
    sessions_that_would_become_ineligible: wouldBecomeIneligible,
    sample_eligible_sessions: sampleEligible,
    sample_ineligible_sessions: sampleIneligible,
  };
}

function normalizeState(raw: string): "inherit" | "included" | "excluded" {
  if (raw === "included" || raw === "excluded") return raw;
  return "inherit";
}
