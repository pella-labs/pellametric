import { db, schema } from "@/lib/db";
import { and, eq, sql } from "drizzle-orm";
import { appFetch } from "@/lib/github-app";

async function userOrgSlugs(token: string): Promise<Set<string>> {
  const r = await fetch("https://api.github.com/user/orgs?per_page=100", {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
    cache: "no-store",
  });
  if (!r.ok) return new Set();
  const list = await r.json();
  return new Set((list as any[]).map(o => (o.login as string).toLowerCase()));
}

async function isMemberViaApp(installationId: number, orgSlug: string, login: string): Promise<boolean> {
  // status=200 (state=active) → active member; 302 → pending invite; 404 → not invited/not member.
  const r = await appFetch(installationId, `/orgs/${orgSlug}/memberships/${login}`, { redirect: "manual" });
  if (r.status !== 200) return false;
  const data = await r.json().catch(() => ({} as any));
  return data?.state === "active";
}

/**
 * Walks all pending invitations matching this user's github login. Verifies they
 * actually belong to the target GitHub org and, if so, flips the invitation to
 * accepted + creates the membership row with the role chosen at invite time.
 *
 * Membership verification prefers the org's GitHub App installation token (no
 * dependency on the user's OAuth grant), and falls back to /user/orgs from the
 * user's OAuth token when no install is present.
 */
export async function acceptPendingInvites(userId: string): Promise<{ accepted: string[]; rejected: string[] }> {
  const out = { accepted: [] as string[], rejected: [] as string[] };

  const [u] = await db.select().from(schema.user).where(eq(schema.user.id, userId)).limit(1);
  if (!u?.githubLogin) return out;

  // Match invitations case-insensitively — newer rows store the canonical
  // GitHub case, but legacy rows are lowercased. user.githubLogin is canonical.
  const login = u.githubLogin;
  const pending = await db
    .select({ inv: schema.invitation, org: schema.org })
    .from(schema.invitation)
    .innerJoin(schema.org, eq(schema.invitation.orgId, schema.org.id))
    .where(and(
      sql`LOWER(${schema.invitation.githubLogin}) = LOWER(${login})`,
      eq(schema.invitation.status, "pending"),
    ));

  if (pending.length === 0) return out;

  // Only fetch the user's OAuth token if we'll actually need it (any pending
  // invite belongs to an org without an App installation).
  const needsOauthFallback = pending.some(p => p.org.githubAppInstallationId == null);
  let oauthSlugs: Set<string> = new Set();
  if (needsOauthFallback) {
    const [acc] = await db.select().from(schema.account)
      .where(and(eq(schema.account.userId, userId), eq(schema.account.providerId, "github")))
      .limit(1);
    if (acc?.accessToken) oauthSlugs = await userOrgSlugs(acc.accessToken);
  }

  for (const row of pending) {
    try {
      const installId = row.org.githubAppInstallationId as number | null;
      const isMember = installId != null
        ? await isMemberViaApp(installId, row.org.slug, login)
        : oauthSlugs.has(row.org.slug.toLowerCase());

      if (!isMember) {
        out.rejected.push(row.org.slug);
        continue;
      }
      await db.insert(schema.membership).values({
        userId, orgId: row.inv.orgId, role: row.inv.role ?? "dev",
      }).onConflictDoNothing();
      await db.update(schema.invitation)
        .set({ status: "accepted", acceptedAt: new Date() })
        .where(eq(schema.invitation.id, row.inv.id));
      out.accepted.push(row.org.slug);
    } catch {
      out.rejected.push(row.org.slug);
    }
  }
  return out;
}
