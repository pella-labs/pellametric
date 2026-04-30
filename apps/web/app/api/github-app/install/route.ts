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

function deriveSlug(login: string): string {
  // GitHub login is already URL-safe (alphanumerics + hyphens); use as-is so the
  // pellametric URL matches the GitHub URL.
  return login;
}

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

  // Whoever installs the App on a GitHub org is, by GitHub's rules, an admin
  // of that org — so we treat the install as the canonical "claim". If the
  // org row doesn't exist yet, create it now and make the installer the
  // first manager. This avoids the OAuth "grant access to org" footgun where
  // users skip the grant step and /user/orgs returns nothing.
  const githubOrgId = String(install.account.id);
  let [org] = await db.select().from(schema.org).where(eq(schema.org.githubOrgId, githubOrgId)).limit(1);

  if (!org) {
    [org] = await db.insert(schema.org).values({
      githubOrgId,
      slug: deriveSlug(install.account.login),
      name: install.account.login,
    }).returning();
  }

  await db.insert(schema.membership).values({
    userId: session.user.id,
    orgId: org.id,
    role: "manager",
  }).onConflictDoNothing();

  await db.update(schema.org)
    .set({ githubAppInstallationId: installationId, githubAppInstalledAt: new Date() })
    .where(eq(schema.org.id, org.id));

  const target = state ? `/org/${state}` : `/org/${org.slug}`;
  return redirectWith(req, target, { installed: "1" });
}
