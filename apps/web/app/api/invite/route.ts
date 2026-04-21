// POST /api/invite     { orgSlug, githubLogin }  — manager only
// GET  /api/invite     ?orgSlug=... — list pending invites in org

import { auth } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

async function requireManager(userId: string, orgSlug: string) {
  const [row] = await db
    .select({ org: schema.org, role: schema.membership.role })
    .from(schema.membership)
    .innerJoin(schema.org, eq(schema.membership.orgId, schema.org.id))
    .where(and(eq(schema.membership.userId, userId), eq(schema.org.slug, orgSlug)))
    .limit(1);
  if (!row || row.role !== "manager") return null;
  return row.org;
}

export async function GET(req: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const orgSlug = searchParams.get("orgSlug");
  if (!orgSlug) return NextResponse.json({ error: "orgSlug required" }, { status: 400 });
  const org = await requireManager(session.user.id, orgSlug);
  if (!org) return NextResponse.json({ error: "not a manager of this org" }, { status: 403 });

  const invites = await db.select().from(schema.invitation).where(eq(schema.invitation.orgId, org.id));
  return NextResponse.json({ invites });
}

const inviteSchema = z.object({
  orgSlug: z.string(),
  githubLogin: z.string().min(1),
});

export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = inviteSchema.parse(await req.json());

  const org = await requireManager(session.user.id, body.orgSlug);
  if (!org) return NextResponse.json({ error: "not a manager of this org" }, { status: 403 });

  const [inv] = await db.insert(schema.invitation).values({
    orgId: org.id,
    githubLogin: body.githubLogin.toLowerCase(),
    invitedByUserId: session.user.id,
  }).onConflictDoNothing().returning();

  return NextResponse.json({ invitation: inv ?? null });
}
