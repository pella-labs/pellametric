// F3.25 — Benchmark page per §2.6.
// Compares the org's headline metrics against a (synthetic, locally-derived)
// cohort. Rows with n<5 are explicitly labeled (no silent dropout).
// This is a within-org benchmark; cross-org benchmarking lives behind the
// cohort API and is gated by the same k-anonymity rules.

import { notFound } from "next/navigation";
import Link from "next/link";
import { and, eq, gte, inArray } from "drizzle-orm";
import { requireMembership } from "@/lib/auth-middleware";
import { insightsRevampEnabled } from "@/lib/feature-flags";
import { db } from "@/lib/db";
import { sessionEvent, pr, user, membership } from "@/lib/db/schema";
import { costFor } from "@/lib/pricing";

export const dynamic = "force-dynamic";

const K_FLOOR = 5;

function money(x: number): string {
  if (x >= 1000) return `$${(x / 1000).toFixed(1)}K`;
  return `$${x.toFixed(2)}`;
}

function p(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(q * sorted.length));
  return sorted[idx];
}

export default async function BenchmarkPage({
  params,
}: {
  params: Promise<{ provider: string; slug: string }>;
}) {
  if (!insightsRevampEnabled()) notFound();
  const { provider, slug } = await params;
  const auth = await requireMembership(slug, { provider, requiredRole: "manager" });
  if (auth instanceof Response) {
    return (
      <div className="p-8 mk-table-cell">
        Benchmark is manager-only. {auth.status === 401 ? "Sign in to view." : "Access denied."}
      </div>
    );
  }

  const since = new Date(Date.now() - 30 * 86_400_000);

  // Per-dev aggregates across the org for the last 30d.
  const sessions = await db
    .select()
    .from(sessionEvent)
    .where(and(eq(sessionEvent.orgId, auth.org.id), gte(sessionEvent.startedAt, since)));

  const prs = await db
    .select({ authorLogin: pr.authorLogin, mergedAt: pr.mergedAt, kind: pr.kind })
    .from(pr)
    .where(
      and(
        eq(pr.orgId, auth.org.id),
        eq(pr.state, "merged"),
        gte(pr.mergedAt, since),
      ),
    );

  const memberRows = await db
    .select({ userId: membership.userId })
    .from(membership)
    .where(eq(membership.orgId, auth.org.id));
  const memberIds = memberRows.map(m => m.userId);
  const userRows = memberIds.length > 0
    ? await db.select({ id: user.id, login: user.githubLogin }).from(user).where(inArray(user.id, memberIds))
    : [];
  const loginByUser = new Map(userRows.map(u => [u.id, u.login]));

  const perDev = new Map<string, { spend: number; sessions: number; prsMerged: number; tokensIn: number; tokensOut: number }>();
  for (const s of sessions) {
    const v = perDev.get(s.userId) ?? { spend: 0, sessions: 0, prsMerged: 0, tokensIn: 0, tokensOut: 0 };
    v.sessions++;
    v.tokensIn += s.tokensIn;
    v.tokensOut += s.tokensOut;
    v.spend += costFor(s.model, {
      tokensIn: s.tokensIn,
      tokensOut: s.tokensOut,
      tokensCacheRead: s.tokensCacheRead,
      tokensCacheWrite: s.tokensCacheWrite,
    });
    perDev.set(s.userId, v);
  }
  for (const p of prs) {
    if (p.kind === "revert" || !p.authorLogin) continue;
    // Find user with this githubLogin in org.
    const u = userRows.find(u => u.login === p.authorLogin);
    if (!u) continue;
    const v = perDev.get(u.id);
    if (!v) continue;
    v.prsMerged++;
  }

  // Org headline (over all devs with activity).
  const activeDevs = Array.from(perDev.values());
  const cohortSize = activeDevs.length;

  const orgCostPerPr = (() => {
    const totalSpend = activeDevs.reduce((s, v) => s + v.spend, 0);
    const totalPrs = activeDevs.reduce((s, v) => s + v.prsMerged, 0);
    return totalPrs > 0 ? totalSpend / totalPrs : 0;
  })();
  const orgSessionsPerDev = activeDevs.length > 0 ? activeDevs.reduce((s, v) => s + v.sessions, 0) / activeDevs.length : 0;
  const orgPrsPerDev = activeDevs.length > 0 ? activeDevs.reduce((s, v) => s + v.prsMerged, 0) / activeDevs.length : 0;

  const perDevCostPerPr = activeDevs.filter(v => v.prsMerged > 0).map(v => v.spend / v.prsMerged);
  const perDevSessions = activeDevs.map(v => v.sessions);
  const perDevPrs = activeDevs.map(v => v.prsMerged);

  const kOk = cohortSize >= K_FLOOR;
  function row(label: string, your: number, fmt: (n: number) => string, samples: number[]) {
    const n = samples.length;
    const enoughForP10 = n >= K_FLOOR;
    return { label, your: fmt(your), p50: enoughForP10 ? fmt(p(samples, 0.5)) : "—", p10: enoughForP10 ? fmt(p(samples, 0.1)) : "—", n };
  }

  const rows = [
    row("$ per merged PR", orgCostPerPr, money, perDevCostPerPr),
    row("Sessions per dev", orgSessionsPerDev, n => n.toFixed(1), perDevSessions),
    row("PRs merged per dev", orgPrsPerDev, n => n.toFixed(1), perDevPrs),
  ];

  return (
    <div className="p-6 space-y-6">
      <header>
        <p className="mk-eyebrow">Benchmark · last 30d</p>
        <h1 className="mk-heading text-2xl">How does the org stack up?</h1>
        <p className="mk-table-cell text-(--muted-foreground)">
          Compared against the per-dev distribution inside the same org. Rows with n &lt; {K_FLOOR}{" "}
          contributors are hidden (no silent dropout — they appear as &ldquo;—&rdquo; with a note).
        </p>
      </header>

      {!kOk && (
        <div className="mk-panel border-(--warning)">
          <p className="mk-label">Cohort too small ({cohortSize} active dev{cohortSize === 1 ? "" : "s"})</p>
          <p className="mk-table-cell text-(--muted-foreground) mt-1">
            Benchmarks render at a per-dev distribution and need at least {K_FLOOR}{" "}
            distinct contributors. Add devs or widen the time window.
          </p>
        </div>
      )}

      <div className="mk-panel">
        <table className="w-full mk-table-cell">
          <thead className="text-left border-b border-(--border) text-(--muted-foreground)">
            <tr>
              <th className="py-2 pr-2">Metric</th>
              <th className="py-2 px-2 text-right">Your org</th>
              <th className="py-2 px-2 text-right">P50 dev</th>
              <th className="py-2 px-2 text-right">P10 dev</th>
              <th className="py-2 pl-2 text-right">n</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.label} className="border-b border-(--border)">
                <td className="py-2 pr-2 text-(--foreground)">{r.label}</td>
                <td className="py-2 px-2 text-right text-(--foreground)">{r.your}</td>
                <td className="py-2 px-2 text-right text-(--foreground)">{r.p50}</td>
                <td className="py-2 px-2 text-right text-(--foreground)">{r.p10}</td>
                <td className="py-2 pl-2 text-right text-(--muted-foreground)">{r.n}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mk-table-cell text-(--muted-foreground)">
        Cross-org benchmarking lives behind the cohort API and is rate-limited + audit-logged.{" "}
        <Link href={`/org/${provider}/${slug}/insights`} className="text-(--accent) hover:underline">
          Open the insight builder
        </Link>{" "}
        to slice your own data more finely.
      </p>
    </div>
  );
}
