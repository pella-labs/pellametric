// POST /api/invite     { orgSlug, githubLogin }  — manager only
// GET  /api/invite     ?orgSlug=... — list pending invites in org

import { auth } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { appFetch, appConfigured, installUrl } from "@/lib/github-app";

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

  const useApp = appConfigured() && org.githubAppInstallationId != null;
  const installationId = org.githubAppInstallationId as number | null;
  const typedInput = body.githubLogin.trim();

  // First, look up the user on GitHub to (a) confirm they exist and (b) get the
  // canonical login spelling. GitHub usernames are case-insensitive at lookup, so
  // any typo that resolves to a different real account would silently invite the
  // wrong person — using the canonical login from /users/{name} catches that and
  // gives us a consistent value to store/display.
  const userRes = useApp
    ? await appFetch(installationId!, `/users/${typedInput}`)
    : await fetch(`https://api.github.com/users/${typedInput}`, {
        headers: { Authorization: `Bearer ${acc.accessToken}`, Accept: "application/vnd.github+json" },
      });
  if (!userRes.ok) {
    return NextResponse.json({ error: `${typedInput} is not a valid GitHub user` }, { status: 400 });
  }
  const ghUser = await userRes.json() as { login: string; id: number; type?: string };
  const login = ghUser.login;

  // Public member check (204 = member). Prefer the App's installation token when
  // available — it's not user-rate-limited and doesn't require admin:org scope on
  // any single user. Fall back to the caller's user OAuth token.
  const pub = useApp
    ? await appFetch(installationId!, `/orgs/${org.slug}/members/${login}`, { redirect: "manual" })
    : await fetch(`https://api.github.com/orgs/${org.slug}/members/${login}`, {
        headers: { Authorization: `Bearer ${acc.accessToken}`, Accept: "application/vnd.github+json" },
        redirect: "manual",
      });
  const alreadyMember = pub.status === 204;

  // Try to invite them to the GitHub org so they don't have to be added manually first.
  let github:
    | { ok: true; status: "already_member" | "invited" | "active"; via: "app" | "user" }
    | { ok: false; error: string; install_url?: string }
    | null = null;

  if (alreadyMember) {
    github = { ok: true, status: "already_member", via: useApp ? "app" : "user" };
  } else if (useApp) {
    const inviteRes = await appFetch(installationId!, `/orgs/${org.slug}/memberships/${login}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "member" }),
    });
    if (inviteRes.ok) {
      const data = await inviteRes.json().catch(() => ({} as any));
      github = { ok: true, status: data?.state === "active" ? "active" : "invited", via: "app" };
    } else {
      const data = await inviteRes.json().catch(() => ({} as any));
      github = { ok: false, error: data?.message ?? `GitHub invite failed (${inviteRes.status})` };
    }
  } else {
    // No App installed — surface a CTA to install it instead of relying on user OAuth scopes.
    const url = installUrl(org.slug);
    github = {
      ok: false,
      error: url
        ? "Install Pellametric on this GitHub org to enable invites."
        : "GitHub invites are not configured on this server.",
      ...(url ? { install_url: url } : {}),
    };
  }

  const [inv] = await db.insert(schema.invitation).values({
    orgId: org.id,
    githubLogin: login,
    invitedByUserId: session.user.id,
    role: body.role,
  }).onConflictDoNothing().returning();

  return NextResponse.json({ invitation: inv ?? null, github });
}
