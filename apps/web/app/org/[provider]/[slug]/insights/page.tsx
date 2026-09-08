// F2.13 — Manager insight builder. /org/[provider]/[slug]/insights
// Server-component wrapper: resolves auth + org, then hands off to the
// client builder. Flagged behind PELLAMETRIC_INSIGHTS_REVAMP_UI.

import { notFound } from "next/navigation";
import { insightsRevampEnabled } from "@/lib/feature-flags";
import { requireMembership } from "@/lib/auth-middleware";
import { InsightBuilder } from "@/components/insights/insight-builder";

export const dynamic = "force-dynamic";

export default async function Page({
  params,
}: {
  params: Promise<{ provider: string; slug: string }>;
}) {
  if (!insightsRevampEnabled()) notFound();
  const { provider, slug } = await params;
  const auth = await requireMembership(slug, { provider });
  if (auth instanceof Response) {
    return (
      <div className="p-8 mk-table-cell">
        Access denied.
      </div>
    );
  }
  return (
    <InsightBuilder
      orgSlug={slug}
      provider={provider}
      scope="org"
      orgDisplayName={auth.org.name ?? slug}
      role={auth.membership.role === "manager" ? "manager" : "dev"}
    />
  );
}
