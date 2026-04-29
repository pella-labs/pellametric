// GET  /api/orgs           -> list GitHub orgs the user belongs to (from their access token)
// POST /api/orgs           -> claim an org (becomes manager); body: { githubOrgId, slug, name }

import { auth } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

async function getGithubAccessToken(userId: string): Promise<string | null> {
  const [acc] = await db
    .select()
    .from(schema.account)
    .where(and(eq(schema.account.userId, userId), eq(schema.account.providerId, "github")))
    .limit(1);
  return acc?.accessToken ?? null;
}

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const token = await getGithubAccessToken(session.user.id);
  if (!token) return NextResponse.json({ error: "no github token" }, { status: 400 });

  // /user/memberships/orgs covers private memberships where /user/orgs may miss rows.
  const r = await fetch("https://api.github.com/user/memberships/orgs?state=active&per_page=100", {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
    cache: "no-store",
  });
  if (!r.ok) return NextResponse.json({ error: "github api error", detail: await r.text() }, { status: 502 });
  const memberships = await r.json();
  const orgs = (memberships as any[]).map(m => ({ ...m.organization, role: m.role }));

  // Which of these is this user already a member of in our DB?
  const mine = await db
    .select({ org: schema.org })
    .from(schema.membership)
    .innerJoin(schema.org, eq(schema.membership.orgId, schema.org.id))
    .where(eq(schema.membership.userId, session.user.id));
  const mySlugs = new Set(mine.map(m => m.org.slug.toLowerCase()));

  return NextResponse.json({
    orgs: orgs.map((o: any) => ({
      id: String(o.id),
      login: o.login,
      name: o.login,
      avatar: o.avatar_url ?? null,
      connected: mySlugs.has((o.login as string).toLowerCase()),
    })),
  });
}

const claimSchema = z.object({
  githubOrgId: z.string(),
  slug: z.string().min(1),
  name: z.string().min(1),
});

export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = claimSchema.parse(await req.json());

  // First-claim-wins: only create a manager membership if the org has never been
  // connected here before. If it already exists, the caller must be invited by
  // an existing manager — no self-promotion via /setup/org.
  const [existing] = await db
    .select().from(schema.org).where(eq(schema.org.githubOrgId, body.githubOrgId)).limit(1);

  if (existing) {
    const [mine] = await db.select().from(schema.membership)
      .where(and(eq(schema.membership.userId, session.user.id), eq(schema.membership.orgId, existing.id)))
      .limit(1);
    if (mine) return NextResponse.json({ org: existing });
    return NextResponse.json(
      { error: "This org is already connected. Ask a manager for an invite." },
      { status: 403 },
    );
  }

  const [orgRow] = await db.insert(schema.org).values({
    githubOrgId: body.githubOrgId, slug: body.slug, name: body.name,
  }).returning();

  await db.insert(schema.membership).values({
    userId: session.user.id,
    orgId: orgRow.id,
    role: "manager",
  }).onConflictDoNothing();

  return NextResponse.json({ org: orgRow });
}
