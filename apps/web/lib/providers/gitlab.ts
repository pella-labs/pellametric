/**
 * GitLab provider. See docs/multi-provider.md §5, §7.
 *
 * Implementation status:
 *   - listConnectableOrgs   ✓ Phase 4
 *   - connectOrg            ✓ Phase 4
 *   - inviteMember          — Phase 6
 *   - resolveMember         — Phase 6
 *   - fetchChangeRequests   — Phase 7
 */

import { db, schema } from "@/lib/db";
import { and, eq } from "drizzle-orm";
import { encryptOrgCredential, decryptOrgCredential } from "@/lib/crypto/org-credentials";
import { assertNoSlugOverlap, SlugOverlapError } from "@/lib/orgs/validate-slug";
import { mapHttpStatusToProviderError, ProviderError } from "./errors";
import { gitlabCanWrite } from "./scopes";
import type {
  Provider, ConnectableOrg, ChangeRequestAgg, InviteResult, MemberRef,
} from "./types";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const GITLAB = "https://gitlab.com";

const NOT_IMPLEMENTED = (m: string) => new Error(`gitlab.${m} not implemented yet (see docs/multi-provider-execution.md)`);

/** GET /api/v4/* using the user's OAuth bearer token. */
async function gitlabUserApi<T = any>(path: string, oauthToken: string): Promise<T> {
  const r = await fetch(`${GITLAB}/api/v4${path}`, {
    headers: { Authorization: `Bearer ${oauthToken}` },
    cache: "no-store",
  });
  if (!r.ok) throw mapHttpStatusToProviderError(r.status, r.headers.get("retry-after"));
  return r.json() as Promise<T>;
}

/** GET /api/v4/* using a Group Access Token (PRIVATE-TOKEN header). */
async function gitlabGatApi<T = any>(path: string, gat: string): Promise<T> {
  const r = await fetch(`${GITLAB}/api/v4${path}`, {
    headers: { "PRIVATE-TOKEN": gat },
    cache: "no-store",
  });
  if (!r.ok) throw mapHttpStatusToProviderError(r.status, r.headers.get("retry-after"));
  return r.json() as Promise<T>;
}

/**
 * Get a valid GitLab access token for the org, regardless of credential kind.
 *
 * - kind='gitlab_oauth_app': returns the access_token, refreshing it transparently
 *   if it's within 60s of expiry. Persists the new tokens.
 * - kind='gitlab_gat': returns the GAT/PAT plaintext. No refresh; returns
 *   expired_credential if the stored expiry has passed.
 *
 * Routes/callers call this and don't have to know which kind backs the org.
 */
async function getOrgGat(orgId: string): Promise<{ gat: string; groupId: string; scopes: string | null }> {
  const [org] = await db.select().from(schema.org).where(eq(schema.org.id, orgId)).limit(1);
  if (!org) throw new ProviderError("not_found", undefined, undefined, `Org not found: ${orgId}`);
  if (org.provider !== "gitlab" || !org.gitlabGroupId) {
    throw new ProviderError("permission_denied", undefined, undefined, "Org is not a GitLab org");
  }
  // Try OAuth-app credential first (preferred), else fall back to GAT/PAT.
  const [oauth] = await db.select().from(schema.orgCredentials)
    .where(and(eq(schema.orgCredentials.orgId, orgId), eq(schema.orgCredentials.kind, "gitlab_oauth_app")))
    .limit(1);
  if (oauth) {
    const token = await getValidOauthAccessToken(oauth);
    return { gat: token, groupId: org.gitlabGroupId, scopes: oauth.scopes };
  }
  const [gat] = await db.select().from(schema.orgCredentials)
    .where(and(eq(schema.orgCredentials.orgId, orgId), eq(schema.orgCredentials.kind, "gitlab_gat")))
    .limit(1);
  if (!gat) {
    throw new ProviderError("expired_credential", undefined, undefined, "No GitLab credential for this org");
  }
  if (gat.expiresAt && gat.expiresAt.getTime() <= Date.now()) {
    throw new ProviderError("expired_credential", undefined, undefined, "GAT expired");
  }
  return { gat: decryptOrgCredential(gat.tokenEnc), groupId: org.gitlabGroupId, scopes: gat.scopes };
}

/**
 * For an OAuth-app credential row, return a valid access token. If the stored
 * access token is within 60s of expiry, exchange the refresh token for a new
 * one and persist the result before returning.
 */
async function getValidOauthAccessToken(cred: typeof schema.orgCredentials.$inferSelect): Promise<string> {
  const REFRESH_BUFFER_MS = 60_000;
  const now = Date.now();
  const expiresAt = cred.expiresAt?.getTime() ?? 0;
  if (expiresAt - now > REFRESH_BUFFER_MS) {
    return decryptOrgCredential(cred.tokenEnc);
  }
  // Refresh required.
  if (!cred.refreshTokenEnc || !cred.clientId || !cred.clientSecretEnc) {
    throw new ProviderError("expired_credential", undefined, undefined,
      "OAuth access token expired and no refresh token stored — reconnect the org");
  }
  const refreshToken = decryptOrgCredential(cred.refreshTokenEnc);
  const clientSecret = decryptOrgCredential(cred.clientSecretEnc);
  const r = await fetch(`${GITLAB}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_id: cred.clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
    cache: "no-store",
  });
  if (!r.ok) {
    // Mark as expired so the next caller surfaces a "reconnect" UX.
    await db.update(schema.orgCredentials)
      .set({ expiresAt: new Date() })
      .where(eq(schema.orgCredentials.id, cred.id));
    throw mapHttpStatusToProviderError(r.status, r.headers.get("retry-after"));
  }
  const tok = await r.json() as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!tok.access_token) {
    throw new ProviderError("expired_credential", undefined, undefined, "Refresh returned no access_token");
  }
  const newAccessExpiresAt = tok.expires_in
    ? new Date(Date.now() + tok.expires_in * 1000)
    : new Date(Date.now() + 2 * 60 * 60 * 1000);
  await db.update(schema.orgCredentials)
    .set({
      tokenEnc: encryptOrgCredential(tok.access_token),
      refreshTokenEnc: tok.refresh_token ? encryptOrgCredential(tok.refresh_token) : cred.refreshTokenEnc,
      expiresAt: newAccessExpiresAt,
      lastUsedAt: new Date(),
    })
    .where(eq(schema.orgCredentials.id, cred.id));
  return tok.access_token;
}

/** Mark the org's GAT as effectively expired so the UI shows the reconnect banner. */
async function markCredentialExpired(orgId: string): Promise<void> {
  await db.update(schema.orgCredentials)
    .set({ expiresAt: new Date() })
    .where(and(eq(schema.orgCredentials.orgId, orgId), eq(schema.orgCredentials.kind, "gitlab_gat")));
}

/** Look up the calling user's GitLab OAuth access token from better-auth's `account` table. */
async function getUserOauthToken(userId: string): Promise<string> {
  const [acc] = await db.select().from(schema.account)
    .where(and(eq(schema.account.userId, userId), eq(schema.account.providerId, "gitlab")))
    .limit(1);
  if (!acc?.accessToken) {
    throw new ProviderError("expired_credential", undefined, undefined, "User has no GitLab OAuth token");
  }
  return acc.accessToken;
}

export const gitlabProvider: Provider = {
  /**
   * List groups the user can connect. Filtered to Maintainer (40) and above
   * because lower roles can't create the Group Access Token we need.
   */
  async listConnectableOrgs(userId: string): Promise<ConnectableOrg[]> {
    const token = await getUserOauthToken(userId);
    const groups = await gitlabUserApi<any[]>("/groups?min_access_level=40&per_page=100", token);
    return groups.map(g => ({
      externalId: g.id,
      path: g.full_path,
      name: g.full_name ?? g.name,
      avatar: g.avatar_url ?? null,
    }));
  },

  /**
   * Persist a GitLab group as a Telemetryc org.
   *   - validates the GAT against the chosen group
   *   - rejects prefix-overlapping slugs
   *   - inserts org + org_credentials + manager membership in one transaction
   *
   * `credential` is the Group Access Token plaintext.
   */
  async connectOrg(input: {
    userId: string;
    externalId: string | number;
    credential?: string;
  }): Promise<{ orgId: string }> {
    const { userId, externalId, credential } = input;
    if (!credential) {
      throw new ProviderError("permission_denied", undefined, undefined, "Group Access Token required");
    }

    // 1. Validate: the GAT must be able to read the group it claims.
    //    `externalId` may be either a numeric group id (from the picker) or a
    //    URL-encoded path (from manual entry). GitLab's /groups/:id endpoint
    //    accepts both. We only verify "matches" when externalId is numeric,
    //    since for paths we trust whatever group GitLab resolves them to.
    let group: any;
    try {
      group = await gitlabGatApi<any>(`/groups/${externalId}`, credential);
    } catch (e) {
      if (e instanceof ProviderError) throw e;
      throw new ProviderError("permission_denied");
    }
    const externalIdIsNumeric = /^\d+$/.test(String(externalId));
    if (externalIdIsNumeric && String(group.id) !== String(externalId)) {
      throw new ProviderError("permission_denied", undefined, undefined,
        "GAT does not match the selected group");
    }

    // 2. Decode token expiry + scopes. The "self" endpoint introspects the
    //    pasted GAT and tells us what scopes the customer actually granted.
    //    We use scopes to gate write features (invites) and surface a clear
    //    UI when they pasted a read-only token. Best-effort: tier or future
    //    GitLab change could break this; in that case scopes stay NULL and
    //    we fall back to "minimal scope assumed".
    let expiresAt: Date | null = null;
    let scopesStr: string | null = null;
    try {
      const self = await gitlabGatApi<any>("/personal_access_tokens/self", credential);
      if (self?.expires_at) expiresAt = new Date(self.expires_at);
      if (Array.isArray(self?.scopes) && self.scopes.length > 0) {
        scopesStr = (self.scopes as string[]).map(s => String(s)).join(",");
      }
    } catch { /* best-effort */ }

    // 3. Slug = lowercased full_path. Reject overlap.
    const slug = String(group.full_path).toLowerCase();
    await assertNoSlugOverlap("gitlab", slug);

    // 4. Encrypt GAT. Insert in transaction.
    const tokenEnc = encryptOrgCredential(credential);

    let orgId: string = "";
    await db.transaction(async tx => {
      const [inserted] = await tx.insert(schema.org).values({
        provider: "gitlab",
        slug,
        name: group.full_name ?? group.name,
        gitlabGroupId: String(group.id),
        gitlabGroupPath: String(group.full_path),
      }).returning({ id: schema.org.id });
      orgId = inserted.id;

      await tx.insert(schema.orgCredentials).values({
        orgId,
        kind: "gitlab_gat",
        tokenEnc,
        expiresAt,
        scopes: scopesStr,
      });

      await tx.insert(schema.membership).values({
        userId,
        orgId,
        role: "manager",
      });
    });

    return { orgId };
  },

  /**
   * Invite a member by GitLab username or email.
   *   - Existing GitLab user → add directly via /groups/:id/members.
   *   - Email of someone not on GitLab → invite via /groups/:id/invitations.
   *   - Otherwise → null (caller renders "user not found").
   *
   * 401/403 → ProviderError.expired_credential AND mark org credential expired.
   */
  async inviteMember(orgId: string, identifier: string): Promise<InviteResult> {
    const { gat, groupId, scopes } = await getOrgGat(orgId);
    if (!gitlabCanWrite(scopes)) {
      throw new ProviderError("permission_denied", undefined, undefined,
        "This GitLab org's token is read-only. Add `api` scope (or rotate the token) to invite from Telemetryc.");
    }
    const trimmed = identifier.trim();

    // Try resolving as a username first.
    let user: any | null = null;
    try {
      const found = await gitlabGatApi<any[]>(`/users?username=${encodeURIComponent(trimmed)}`, gat);
      user = (found?.[0] ?? null);
    } catch (e) {
      if (e instanceof ProviderError && e.code === "expired_credential") {
        await markCredentialExpired(orgId);
      }
      throw e;
    }

    if (user?.id) {
      // Add as a Developer (access_level 30).
      const r = await fetch(`${GITLAB}/api/v4/groups/${groupId}/members`, {
        method: "POST",
        headers: { "PRIVATE-TOKEN": gat, "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: user.id, access_level: 30 }),
      });
      if (r.status === 401 || r.status === 403) {
        await markCredentialExpired(orgId);
        throw mapHttpStatusToProviderError(r.status, r.headers.get("retry-after"));
      }
      // 409 Conflict means already a member — count as success.
      if (!r.ok && r.status !== 409) {
        const data = await r.json().catch(() => ({} as any));
        throw new ProviderError("unknown", r.status, undefined,
          data?.message ?? `GitLab add-member failed (${r.status})`);
      }
      return { status: "added", identifier: user.username };
    }

    if (EMAIL_RE.test(trimmed)) {
      const r = await fetch(`${GITLAB}/api/v4/groups/${groupId}/invitations`, {
        method: "POST",
        headers: { "PRIVATE-TOKEN": gat, "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed, access_level: 30 }),
      });
      if (r.status === 401 || r.status === 403) {
        await markCredentialExpired(orgId);
        throw mapHttpStatusToProviderError(r.status, r.headers.get("retry-after"));
      }
      if (!r.ok) {
        const data = await r.json().catch(() => ({} as any));
        throw new ProviderError("unknown", r.status, undefined,
          data?.message ?? `GitLab invite-by-email failed (${r.status})`);
      }
      return { status: "pending_email", identifier: trimmed };
    }

    throw new ProviderError("not_found", 404, undefined,
      `GitLab user "${trimmed}" not found. To invite by email, type a full email address.`);
  },

  /**
   * Aggregate MRs authored by `memberLogin` in this group, optionally limited to
   * MRs updated since `since`. Aggregates open/merged/closed/openNow + total LOC.
   *
   * GitLab API returns one page at a time; for cost control we fetch only the
   * first 100 (largest per_page allowed for /merge_requests).
   */
  async fetchChangeRequests(orgId: string, memberLogin: string, since?: Date | null): Promise<ChangeRequestAgg> {
    const { gat, groupId } = await getOrgGat(orgId);

    const params = new URLSearchParams({
      author_username: memberLogin,
      scope: "all",
      per_page: "100",
    });
    if (since) params.set("updated_after", since.toISOString());

    let mrs: any[];
    try {
      mrs = await gitlabGatApi<any[]>(
        `/groups/${groupId}/merge_requests?${params.toString()}`,
        gat,
      );
    } catch (e) {
      if (e instanceof ProviderError && e.code === "expired_credential") {
        await markCredentialExpired(orgId);
      }
      throw e;
    }

    const agg: ChangeRequestAgg = {
      login: memberLogin,
      opened: mrs.length,
      merged: 0,
      closed: 0,
      openNow: 0,
      additions: 0,
      deletions: 0,
    };

    for (const mr of mrs) {
      if (mr.state === "merged") agg.merged++;
      else if (mr.state === "closed") agg.closed++;
      else if (mr.state === "opened") agg.openNow++;
      // GitLab's MR list endpoint doesn't include +/- LOC in the basic shape
      // (would need a separate /merge_requests/:iid/changes call per MR — too
      // expensive for now). Leave additions/deletions at 0 until we add a
      // bounded detail-fetch in Phase 10.
    }

    return agg;
  },

  async resolveMember(orgId: string, identifier: string): Promise<MemberRef | null> {
    const { gat } = await getOrgGat(orgId);
    try {
      const found = await gitlabGatApi<any[]>(`/users?username=${encodeURIComponent(identifier.trim())}`, gat);
      const u = found?.[0];
      if (!u) return null;
      return {
        externalId: u.id,
        login: u.username,
        name: u.name ?? null,
        avatar: u.avatar_url ?? null,
      };
    } catch (e) {
      if (e instanceof ProviderError && e.code === "expired_credential") {
        await markCredentialExpired(orgId);
      }
      throw e;
    }
  },
};

// Catch this in the connect server action and surface a friendly error.
export { SlugOverlapError };
