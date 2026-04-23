// POST /api/invite     { orgSlug, githubLogin }  — manager only
// GET  /api/invite     ?orgSlug=... — list pending invites in org

import { db, schema } from "@/lib/db";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/api/error";
import { withAuth } from "@/lib/api/with-auth";

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

export const GET = withAuth(async (req, { userId }) => {
  const { searchParams } = new URL(req.url);
  const orgSlug = searchParams.get("orgSlug");
  if (!orgSlug) return apiError("orgSlug required");
  const org = await requireManager(userId, orgSlug);
  if (!org) return apiError("not a manager of this org", undefined, 403);

  const invites = await db.select().from(schema.invitation).where(eq(schema.invitation.orgId, org.id));
  return NextResponse.json({ invites });
});

const inviteSchema = z.object({
  orgSlug: z.string(),
  githubLogin: z.string().min(1),
});

export const POST = withAuth(async (req, { userId }) => {
  const body = inviteSchema.parse(await req.json());

  const org = await requireManager(userId, body.orgSlug);
  if (!org) return apiError("not a manager of this org", undefined, 403);

  // Verify invitee is actually in the GitHub org
  const [acc] = await db.select().from(schema.account)
    .where(and(eq(schema.account.userId, userId), eq(schema.account.providerId, "github")))
    .limit(1);
  if (!acc?.accessToken) return apiError("no github token");

  const login = body.githubLogin.trim().toLowerCase();
  // Try public member check first; returns 204 if they're a public member of the org.
  const pub = await fetch(`https://api.github.com/orgs/${org.slug}/members/${login}`, {
    headers: { Authorization: `Bearer ${acc.accessToken}`, Accept: "application/vnd.github+json" },
    redirect: "manual",
  });
  // If not publicly visible, verify the login is a valid GitHub user (we'll re-verify on accept).
  if (pub.status !== 204) {
    const u = await fetch(`https://api.github.com/users/${login}`, {
      headers: { Authorization: `Bearer ${acc.accessToken}`, Accept: "application/vnd.github+json" },
    });
    if (!u.ok) {
      return apiError(`${login} is not a valid GitHub user`);
    }
    // Allow the invite; accept will still require real org membership verified via /user/orgs
  }

  const [inv] = await db.insert(schema.invitation).values({
    orgId: org.id,
    githubLogin: login,
    invitedByUserId: userId,
  }).onConflictDoNothing().returning();

  return NextResponse.json({ invitation: inv ?? null });
});
