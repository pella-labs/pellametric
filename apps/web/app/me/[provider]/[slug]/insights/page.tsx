// F2.14 — Dev insight builder. /me/[provider]/[slug]/insights
// User-scoped — filters all queries to the caller's userId.

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
      scope="user"
      orgDisplayName={auth.org.name ?? slug}
      role={auth.membership.role === "manager" ? "manager" : "dev"}
    />
  );
}
