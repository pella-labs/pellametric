import { db, schema } from "@/lib/db";
import { and, eq } from "drizzle-orm";

async function userOrgSlugs(token: string): Promise<Set<string>> {
  const r = await fetch("https://api.github.com/user/orgs?per_page=100", {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
    cache: "no-store",
  });
  if (!r.ok) return new Set();
  const list = await r.json();
  return new Set((list as any[]).map(o => (o.login as string).toLowerCase()));
}

/**
 * Walks all pending invitations matching this user's github login, verifies
 * they're a member of the target org via /user/orgs (respects private membership),
 * and flips matches to accepted + adds a dev membership row.
 */
export async function acceptPendingInvites(userId: string): Promise<{ accepted: string[]; rejected: string[] }> {
  const out = { accepted: [] as string[], rejected: [] as string[] };

  const [u] = await db.select().from(schema.user).where(eq(schema.user.id, userId)).limit(1);
  if (!u?.githubLogin) return out;

  const [acc] = await db.select().from(schema.account)
    .where(and(eq(schema.account.userId, userId), eq(schema.account.providerId, "github")))
    .limit(1);
  if (!acc?.accessToken) return out;

  const login = u.githubLogin.toLowerCase();
  const pending = await db
    .select({ inv: schema.invitation, org: schema.org })
    .from(schema.invitation)
    .innerJoin(schema.org, eq(schema.invitation.orgId, schema.org.id))
    .where(and(eq(schema.invitation.githubLogin, login), eq(schema.invitation.status, "pending")));

  if (pending.length === 0) return out;

  const orgSlugs = await userOrgSlugs(acc.accessToken);

  for (const row of pending) {
    try {
      if (!orgSlugs.has(row.org.slug.toLowerCase())) {
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
