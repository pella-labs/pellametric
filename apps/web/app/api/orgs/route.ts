// GET  /api/orgs           -> list GitHub orgs the user belongs to (from their access token)
// POST /api/orgs           -> claim an org (becomes manager); body: { githubOrgId, slug, name }

import { db, schema } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/api/error";
import { withAuth } from "@/lib/api/with-auth";

export const dynamic = "force-dynamic";

async function getGithubAccessToken(userId: string): Promise<string | null> {
  const [acc] = await db
    .select()
    .from(schema.account)
    .where(and(eq(schema.account.userId, userId), eq(schema.account.providerId, "github")))
    .limit(1);
  return acc?.accessToken ?? null;
}

export const GET = withAuth(async (_req, { userId }) => {
  const token = await getGithubAccessToken(userId);
  if (!token) return apiError("no github token");

  // /user/memberships/orgs covers private memberships where /user/orgs may miss rows.
  const r = await fetch("https://api.github.com/user/memberships/orgs?state=active&per_page=100", {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
    cache: "no-store",
  });
  if (!r.ok) return apiError("github api error", await r.text(), 502);
  const memberships = await r.json();
  const orgs = (memberships as any[]).map(m => ({ ...m.organization, role: m.role }));

  // Which of these is this user already a member of in our DB?
  const mine = await db
    .select({ org: schema.org })
    .from(schema.membership)
    .innerJoin(schema.org, eq(schema.membership.orgId, schema.org.id))
    .where(eq(schema.membership.userId, userId));
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
});

const claimSchema = z.object({
  githubOrgId: z.string(),
  slug: z.string().min(1),
  name: z.string().min(1),
});

export const POST = withAuth(async (req, { userId }) => {
  const body = claimSchema.parse(await req.json());

  // Upsert org, add caller as manager
  const [existing] = await db
    .select().from(schema.org).where(eq(schema.org.githubOrgId, body.githubOrgId)).limit(1);

  let orgRow = existing;
  if (!orgRow) {
    [orgRow] = await db.insert(schema.org).values({
      githubOrgId: body.githubOrgId, slug: body.slug, name: body.name,
    }).returning();
  }

  await db.insert(schema.membership).values({
    userId,
    orgId: orgRow.id,
    role: "manager",
  }).onConflictDoNothing();

  return NextResponse.json({ org: orgRow });
});
