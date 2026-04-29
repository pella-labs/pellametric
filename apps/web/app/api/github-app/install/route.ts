// GET /api/github-app/install?installation_id=...&setup_action=...&state=<orgSlug>
//
// Set this URL as the GitHub App's "Setup URL" (Post-installation Setup URL).
// When an org owner installs the app on their GitHub org, GitHub redirects here
// with installation_id. We resolve the install's account → match it to our
// `org` row by github_org_id → persist the installation_id → bounce the user
// back to the org page.

import { auth } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { getInstallation, appConfigured } from "@/lib/github-app";

export const dynamic = "force-dynamic";

function redirectWith(req: Request, path: string, qs?: Record<string, string>) {
  const u = new URL(path, req.url);
  if (qs) for (const [k, v] of Object.entries(qs)) u.searchParams.set(k, v);
  return NextResponse.redirect(u);
}

export async function GET(req: Request) {
  if (!appConfigured()) {
    return NextResponse.json({ error: "github app not configured" }, { status: 500 });
  }

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    const u = new URL("/", req.url);
    return NextResponse.redirect(u);
  }

  const { searchParams } = new URL(req.url);
  const installationId = Number(searchParams.get("installation_id") ?? "");
  const state = searchParams.get("state") ?? "";

  if (!installationId || Number.isNaN(installationId)) {
    return NextResponse.json({ error: "missing installation_id" }, { status: 400 });
  }

  const install = await getInstallation(installationId);
  if (!install || !install.account) {
    return NextResponse.json({ error: "installation not found" }, { status: 404 });
  }

  // Match the install's GitHub account to one of our `org` rows.
  const githubOrgId = String(install.account.id);
  const [org] = await db.select().from(schema.org).where(eq(schema.org.githubOrgId, githubOrgId)).limit(1);

  if (!org) {
    // The installer connected pellametric and GitHub in different orders.
    // Send them back to /setup/org with a hint; they need to claim the org first.
    return redirectWith(req, "/setup/org", { installError: `Connect "${install.account.login}" first.` });
  }

  // Caller must be a member of this org in pellametric. (Anyone who can install on
  // GitHub is the org owner there, but that doesn't automatically grant pellametric
  // access — we still gate on membership.)
  const [mem] = await db.select().from(schema.membership)
    .where(and(eq(schema.membership.userId, session.user.id), eq(schema.membership.orgId, org.id)))
    .limit(1);
  if (!mem) {
    return NextResponse.json({ error: "you are not a member of this org in pellametric" }, { status: 403 });
  }

  await db.update(schema.org)
    .set({ githubAppInstallationId: installationId, githubAppInstalledAt: new Date() })
    .where(eq(schema.org.id, org.id));

  const target = state ? `/org/${state}` : `/org/${org.slug}`;
  return redirectWith(req, target, { installed: "1" });
}
