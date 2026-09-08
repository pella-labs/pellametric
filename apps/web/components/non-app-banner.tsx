// Phase 6 T6.4 — Two-tier non-App org CTA banner.
// Renders above manager views when the org has no GitHub App installation.
import React from "react";
import Link from "next/link";

export function NonAppBanner({ provider, slug }: { provider: string; slug: string }): React.ReactElement {
  return (
    <div className="border border-(--warning) bg-(--warning)/10 p-4 flex items-start justify-between gap-4">
      <div className="space-y-1">
        <div className="text-sm font-medium">Install the GitHub App for full insights</div>
        <p className="mk-table-cell text-(--muted-foreground)">
          Without the App, PR data is live-fetched and capped at 50 PRs. Cost-per-PR, source
          attribution, and session lineage all require webhook-based PR persistence.
        </p>
      </div>
      <Link
        href={`/api/github-app/install-url?slug=${encodeURIComponent(slug)}&provider=${encodeURIComponent(provider)}`}
        className="mk-table-cell border border-(--warning) px-3 py-1.5 hover:bg-(--warning)/20"
      >
        Install →
      </Link>
    </div>
  );
}
