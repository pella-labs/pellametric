// /me/[provider]/[slug] shell. Dev-personal view layout.
import { notFound } from "next/navigation";
import Link from "next/link";
import { insightsRevampEnabled } from "@/lib/feature-flags";
import { requireMembership } from "@/lib/auth-middleware";

export const dynamic = "force-dynamic";

export default async function Layout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ provider: string; slug: string }>;
}) {
  if (!insightsRevampEnabled()) notFound();
  const { provider, slug } = await params;
  const auth = await requireMembership(slug, { provider });
  if (auth instanceof Response) {
    return <div className="p-8 mk-table-cell">Access denied.</div>;
  }
  const base = `/me/${provider}/${slug}`;
  return (
    <div className="min-h-screen flex">
      <nav className="w-44 border-r border-(--border) p-4 space-y-1">
        <div className="mk-table-cell text-(--muted-foreground) uppercase tracking-wide mb-2">
          {slug} · me
        </div>
        <Link href={base} className="block mk-table-cell hover:text-(--primary)">Overview</Link>
        <Link href={`${base}/insights`} className="block mk-table-cell hover:text-(--primary)">Insights</Link>
        <Link href={`${base}/sessions`} className="block mk-table-cell hover:text-(--primary)">Sessions</Link>
        <Link href={`${base}/prs`} className="block mk-table-cell hover:text-(--primary)">My PRs</Link>
        <div className="pt-3 mt-3 border-t border-(--border)">
          <Link href={`/org/${provider}/${slug}`} className="block mk-table-cell text-(--muted-foreground) hover:text-(--foreground)">
            ← back to org
          </Link>
        </div>
      </nav>
      <main className="flex-1">{children}</main>
    </div>
  );
}
