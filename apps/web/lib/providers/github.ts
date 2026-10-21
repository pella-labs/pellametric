/**
 * GitHub provider. Wraps the existing GitHub-App-based code paths in
 * `lib/github-app.ts` and `lib/gh.ts`. Methods marked TODO will be implemented
 * in the phase that migrates the corresponding route (see
 * docs/multi-provider-execution.md):
 *   - inviteMember           — Phase 6 (move from app/api/invite/route.ts)
 *   - listConnectableOrgs    — Phase 4 (currently routed through GitHub App install UI)
 *   - connectOrg             — Phase 4 (currently happens in /api/github-app/install callback)
 *   - resolveMember          — Phase 6
 */

import { prAggForMember } from "@/lib/gh";
import { appFetch } from "@/lib/github-app";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { mapHttpStatusToProviderError, ProviderError } from "./errors";
import type {
  Provider, ConnectableOrg, ChangeRequestAgg, InviteResult, MemberRef,
} from "./types";

export const githubProvider: Provider = {
  async listConnectableOrgs(_userId: string): Promise<ConnectableOrg[]> {
    throw new Error("github.listConnectableOrgs not yet wired through provider abstraction (Phase 4)");
  },

  async connectOrg(_input): Promise<{ orgId: string }> {
    throw new Error("github.connectOrg not yet wired through provider abstraction (Phase 4)");
  },

  async inviteMember(_orgId: string, _identifier: string): Promise<InviteResult> {
    throw new Error("github.inviteMember not yet wired through provider abstraction (Phase 6)");
  },

  /**
   * Aggregate PRs authored by `memberLogin` in this org. Uses the GitHub App
   * installation token when available; falls back to a search via the caller's
   * OAuth token when the org hasn't installed the App yet (legacy path).
   */
  async fetchChangeRequests(orgId: string, memberLogin: string, since?: Date | null): Promise<ChangeRequestAgg> {
    const [org] = await db.select().from(schema.org).where(eq(schema.org.id, orgId)).limit(1);
    if (!org) throw new Error(`Org not found: ${orgId}`);
    const installationId = org.githubAppInstallationId as number | null;

    // Without the App installed, fetchChangeRequests requires a caller OAuth
    // token from a manager. Surface that as permission_denied so the org page
    // can render the install banner. Callers can still use legacyPrAggForMember
    // directly in that case.
    if (!installationId) {
      throw new ProviderError("permission_denied", undefined, undefined,
        "GitHub App not installed on this org — install Telemetryc first.");
    }

    const dateClause = since ? ` created:>=${since.toISOString().slice(0, 10)}` : "";
    const q = encodeURIComponent(`is:pr org:${org.slug} author:${memberLogin}${dateClause}`);
    const r = await appFetch(installationId, `/search/issues?q=${q}&per_page=100`);
    if (!r.ok) throw mapHttpStatusToProviderError(r.status, r.headers.get("retry-after"));
    const data = await r.json() as any;
    const items = (data?.items ?? []) as any[];

    const agg: ChangeRequestAgg = {
      login: memberLogin,
      opened: items.length,
      merged: 0, closed: 0, openNow: 0, additions: 0, deletions: 0,
    };

    // Bound LOC-detail fetches to the first 50 PRs to keep cost controlled.
    const detailFetches = items.slice(0, 50).map(async (it) => {
      if (it.state === "open") agg.openNow++;
      const merged = !!it.pull_request?.merged_at;
      if (merged) agg.merged++;
      else if (it.state === "closed") agg.closed++;
      try {
        const [owner, repo] = (it.repository_url as string).replace("https://api.github.com/repos/", "").split("/");
        const dr = await appFetch(installationId, `/repos/${owner}/${repo}/pulls/${it.number}`);
        if (dr.ok) {
          const detail = await dr.json() as any;
          agg.additions += detail.additions ?? 0;
          agg.deletions += detail.deletions ?? 0;
        }
      } catch { /* ignore one-PR detail failures */ }
    });
    await Promise.all(detailFetches);

    // State counts only (no LOC) for any PRs beyond the first 50.
    for (const it of items.slice(50)) {
      if (it.state === "open") agg.openNow++;
      const merged = !!it.pull_request?.merged_at;
      if (merged) agg.merged++;
      else if (it.state === "closed") agg.closed++;
    }

    return agg;
  },

  async resolveMember(_orgId: string, _identifier: string): Promise<MemberRef | null> {
    throw new Error("github.resolveMember not yet wired through provider abstraction (Phase 6)");
  },
};

// Re-export the underlying helper so the provider abstraction has a clear
// migration story without duplicating logic. Phase 7 will inline this into
// `fetchChangeRequests` and remove the re-export.
export { prAggForMember as legacyPrAggForMember };
