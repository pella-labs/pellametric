// GET  /api/orgs           -> list GitHub orgs the user belongs to (from their access token)
// POST /api/orgs           -> claim an org (becomes manager); body: { githubOrgId, slug, name }

import { auth } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

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

  const r = await fetch("https://api.github.com/user/orgs", {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
  });
  if (!r.ok) return NextResponse.json({ error: "github api error", detail: await r.text() }, { status: 502 });
  const orgs = await r.json();
  return NextResponse.json({ orgs: orgs.map((o: any) => ({ id: String(o.id), login: o.login, name: o.login })) });
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
    userId: session.user.id,
    orgId: orgRow.id,
    role: "manager",
  }).onConflictDoNothing();

  return NextResponse.json({ org: orgRow });
}
