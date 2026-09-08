// F3.19 — Manager shell. Adds the 240px nav rail prescribed in §4.3 when the
// insights revamp flag is enabled. When the flag is off, this is a no-op
// passthrough so the legacy /org/.../page.tsx renders exactly as it did.

import React from "react";
import { auth } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { insightsRevampEnabled } from "@/lib/feature-flags";
import { ManagerNavRail } from "@/components/insights/manager-nav-rail";
import { KeyboardChords } from "@/components/insights/keyboard-chords";

export const dynamic = "force-dynamic";

export default async function OrgLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ provider: string; slug: string }>;
}) {
  if (!insightsRevampEnabled()) return <>{children}</>;

  const { provider, slug } = await params;
  // Resolve org + role for the rail. If unauthenticated or non-member, let the
  // child page's own guard handle the error UX — don't redirect from here.
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return <>{children}</>;
  const [row] = await db
    .select({ org: schema.org, role: schema.membership.role })
    .from(schema.membership)
    .innerJoin(schema.org, eq(schema.membership.orgId, schema.org.id))
    .where(
      and(
        eq(schema.membership.userId, session.user.id),
        eq(schema.org.slug, slug),
        eq(schema.org.provider, provider),
      ),
    )
    .limit(1);
  if (!row) return <>{children}</>;

  const base = `/org/${provider}/${slug}`;
  const meBase = `/me/${provider}/${slug}`;
  return (
    <div className="min-h-screen flex bg-(--background) text-(--foreground)">
      <ManagerNavRail
        base={base}
        orgName={row.org.name ?? slug}
        role={row.role === "manager" ? "manager" : "dev"}
        meBase={meBase}
      />
      <main className="flex-1 min-w-0">{children}</main>
      <KeyboardChords base={base} />
    </div>
  );
}
