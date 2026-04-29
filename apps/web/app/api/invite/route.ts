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
  role: z.enum(["manager", "dev"]).default("dev"),
});

export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = inviteSchema.parse(await req.json());

  const org = await requireManager(session.user.id, body.orgSlug);
  if (!org) return NextResponse.json({ error: "not a manager of this org" }, { status: 403 });

  // Verify invitee is actually in the GitHub org
  const [acc] = await db.select().from(schema.account)
    .where(and(eq(schema.account.userId, session.user.id), eq(schema.account.providerId, "github")))
    .limit(1);
  if (!acc?.accessToken) return NextResponse.json({ error: "no github token" }, { status: 400 });

  const login = body.githubLogin.trim().toLowerCase();

  // Public member check (204 = member). If they're already in, skip the GitHub invite.
  const pub = await fetch(`https://api.github.com/orgs/${org.slug}/members/${login}`, {
    headers: { Authorization: `Bearer ${acc.accessToken}`, Accept: "application/vnd.github+json" },
    redirect: "manual",
  });
  const alreadyMember = pub.status === 204;

  if (!alreadyMember) {
    const u = await fetch(`https://api.github.com/users/${login}`, {
      headers: { Authorization: `Bearer ${acc.accessToken}`, Accept: "application/vnd.github+json" },
    });
    if (!u.ok) {
      return NextResponse.json({ error: `${login} is not a valid GitHub user` }, { status: 400 });
    }
  }

  // Try to invite them to the GitHub org so they don't have to be added manually first.
  // Requires write:org scope and the caller to be a GitHub org admin/owner. We don't fail
  // the pellametric invite when this fails — the manager can still hand-invite on GitHub
  // and the receiver can accept here once they're in the org.
  let github: { ok: true; status: "already_member" | "invited" | "active" } | { ok: false; error: string } | null = null;
  if (alreadyMember) {
    github = { ok: true, status: "already_member" };
  } else {
    const inviteRes = await fetch(`https://api.github.com/orgs/${org.slug}/memberships/${login}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${acc.accessToken}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ role: "member" }),
    });
    if (inviteRes.ok) {
      const data = await inviteRes.json().catch(() => ({} as any));
      // GitHub returns state="pending" until the user accepts, "active" if they're already a member
      github = { ok: true, status: data?.state === "active" ? "active" : "invited" };
    } else {
      const data = await inviteRes.json().catch(() => ({} as any));
      const scopes = inviteRes.headers.get("x-oauth-scopes") ?? "";
      const hasWriteOrg = /\b(write|admin):org\b/.test(scopes);
      let msg = data?.message ?? `GitHub invite failed (${inviteRes.status})`;
      if (!hasWriteOrg) msg = "Sign out and back in to refresh GitHub permissions, then retry.";
      else if (inviteRes.status === 403) msg = "You don't have permission to invite to this GitHub org. Ask an org admin/owner.";
      github = { ok: false, error: msg };
    }
  }

  const [inv] = await db.insert(schema.invitation).values({
    orgId: org.id,
    githubLogin: login,
    invitedByUserId: session.user.id,
    role: body.role,
  }).onConflictDoNothing().returning();

  return NextResponse.json({ invitation: inv ?? null, github });
}
