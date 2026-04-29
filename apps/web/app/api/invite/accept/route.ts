// POST /api/invite/accept
// Dev claims pending invitations matching their GitHub login AFTER confirming
// they're an actual member of the target GitHub org.

import { auth } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { NextResponse } from "next/server";

async function isGithubOrgMember(org: string, login: string, token: string): Promise<boolean> {
  // 204 = member, 302 = requires auth, 404 = not a member
  const r = await fetch(`https://api.github.com/orgs/${org}/members/${login}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
    cache: "no-store",
    redirect: "manual",
  });
  return r.status === 204;
}

export async function POST() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const [u] = await db.select().from(schema.user).where(eq(schema.user.id, session.user.id)).limit(1);
  if (!u?.githubLogin) return NextResponse.json({ error: "no github login on account" }, { status: 400 });

  const [acc] = await db.select().from(schema.account)
    .where(and(eq(schema.account.userId, session.user.id), eq(schema.account.providerId, "github")))
    .limit(1);
  if (!acc?.accessToken) return NextResponse.json({ error: "no github token" }, { status: 400 });

  const login = u.githubLogin.toLowerCase();
  const pending = await db
    .select({ inv: schema.invitation, org: schema.org })
    .from(schema.invitation)
    .innerJoin(schema.org, eq(schema.invitation.orgId, schema.org.id))
    .where(and(eq(schema.invitation.githubLogin, login), eq(schema.invitation.status, "pending")));

  const accepted: any[] = [];
  const rejected: any[] = [];
  for (const row of pending) {
    const isMember = await isGithubOrgMember(row.org.slug, login, acc.accessToken);
    if (!isMember) {
      rejected.push({ org: row.org.slug, reason: "not a GitHub member of this org" });
      continue;
    }
    await db.insert(schema.membership).values({
      userId: session.user.id, orgId: row.inv.orgId, role: row.inv.role ?? "dev",
    }).onConflictDoNothing();
    await db.update(schema.invitation)
      .set({ status: "accepted", acceptedAt: new Date() })
      .where(eq(schema.invitation.id, row.inv.id));
    accepted.push({ org: row.org.slug });
  }
  return NextResponse.json({ accepted, rejected });
}
