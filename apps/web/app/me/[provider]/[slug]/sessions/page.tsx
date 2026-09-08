// F3.27 — Dev sessions list. Filters: source, intent, repo. Pagination via
// ?after= cursor (id of last session shown).

import { headers } from "next/headers";
import Link from "next/link";
import { and, eq, desc, gte, lt } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { requireMembership } from "@/lib/auth-middleware";
import { SourceChip } from "@/components/data/source-chip";
import { costFor } from "@/lib/pricing";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 40;

function money(x: number): string {
  if (x >= 1000) return `$${(x / 1000).toFixed(1)}K`;
  return `$${x.toFixed(2)}`;
}

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ provider: string; slug: string }>;
  searchParams: Promise<{ source?: string; intent?: string; repo?: string; before?: string }>;
}) {
  const { provider, slug } = await params;
  const sp = await searchParams;
  const memb = await requireMembership(slug, { provider });
  if (memb instanceof Response) {
    return <div className="p-8 mk-table-cell">Access denied.</div>;
  }
  const session = await auth.api.getSession({ headers: await headers() });
  const userId = session?.user?.id;
  if (!userId) return <div className="p-8 mk-table-cell">Not signed in.</div>;

  const conds = [
    eq(schema.sessionEvent.userId, userId),
    eq(schema.sessionEvent.orgId, memb.org.id),
    gte(schema.sessionEvent.startedAt, new Date(Date.now() - 180 * 86_400_000)),
  ];
  if (sp.source) conds.push(eq(schema.sessionEvent.source, sp.source));
  if (sp.intent) conds.push(eq(schema.sessionEvent.intentTop, sp.intent));
  if (sp.repo) conds.push(eq(schema.sessionEvent.repo, sp.repo));
  if (sp.before) conds.push(lt(schema.sessionEvent.startedAt, new Date(sp.before)));

  const rows = await db
    .select()
    .from(schema.sessionEvent)
    .where(and(...conds))
    .orderBy(desc(schema.sessionEvent.startedAt))
    .limit(PAGE_SIZE + 1);

  const hasMore = rows.length > PAGE_SIZE;
  const pageRows = rows.slice(0, PAGE_SIZE);

  function withParam(name: string, value: string | null): string {
    const p = new URLSearchParams();
    if (sp.source && name !== "source") p.set("source", sp.source);
    if (sp.intent && name !== "intent") p.set("intent", sp.intent);
    if (sp.repo && name !== "repo") p.set("repo", sp.repo);
    if (value) p.set(name, value);
    return `?${p.toString()}`;
  }

  const base = `/me/${provider}/${slug}`;
  return (
    <div className="p-6 space-y-6">
      <header>
        <p className="mk-eyebrow">Me · sessions</p>
        <h1 className="mk-heading text-2xl">All sessions</h1>
      </header>

      {/* Active filters */}
      <div className="flex flex-wrap items-center gap-2 mk-table-cell">
        <span className="mk-label">Filters</span>
        {!sp.source && !sp.intent && !sp.repo && (
          <span className="text-(--ink-faint)">none</span>
        )}
        {(["source", "intent", "repo"] as const).map(k =>
          sp[k] ? (
            <Link
              key={k}
              href={`${base}/sessions${withParam(k, null).replace(`${k}=${sp[k]}`, "")}`}
              className="border border-(--border) hover:border-(--destructive) rounded-[var(--radius)] px-2 py-1 inline-flex items-center gap-2"
            >
              <span className="text-(--muted-foreground)">{k}</span>
              <span className="text-(--foreground)">= {sp[k]}</span>
              <span className="text-(--destructive)" aria-hidden>
                ✕
              </span>
            </Link>
          ) : null,
        )}
      </div>

      <div className="mk-panel">
        {pageRows.length === 0 ? (
          <p className="mk-table-cell text-(--muted-foreground)">No sessions match.</p>
        ) : (
          <table className="w-full mk-table-cell">
            <thead className="text-left border-b border-(--border) text-(--muted-foreground)">
              <tr>
                <th className="py-2 pr-2">When</th>
                <th className="py-2 px-2">Source</th>
                <th className="py-2 px-2">Intent</th>
                <th className="py-2 px-2">Repo</th>
                <th className="py-2 px-2 text-right">Tokens out</th>
                <th className="py-2 pl-2 text-right">Cost</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map(s => {
                const cost = costFor(s.model, {
                  tokensIn: s.tokensIn,
                  tokensOut: s.tokensOut,
                  tokensCacheRead: s.tokensCacheRead,
                  tokensCacheWrite: s.tokensCacheWrite,
                });
                return (
                  <tr key={s.id} className="border-b border-(--border) hover:bg-(--secondary)">
                    <td className="py-2 pr-2">
                      <Link href={`${base}/sessions/${s.id}`} className="text-(--foreground) hover:underline">
                        {s.startedAt.toISOString().slice(0, 16).replace("T", " ")}
                      </Link>
                    </td>
                    <td className="py-2 px-2">
                      <Link href={`${base}/sessions${withParam("source", s.source)}`}>
                        <SourceChip kind={s.source as "claude" | "codex" | "cursor"} />
                      </Link>
                    </td>
                    <td className="py-2 px-2">
                      {s.intentTop ? (
                        <Link
                          href={`${base}/sessions${withParam("intent", s.intentTop)}`}
                          className="text-(--muted-foreground) hover:text-(--foreground)"
                        >
                          {s.intentTop}
                        </Link>
                      ) : (
                        <span className="text-(--ink-faint)">—</span>
                      )}
                    </td>
                    <td className="py-2 px-2 text-(--muted-foreground) truncate max-w-[280px]">
                      <Link
                        href={`${base}/sessions${withParam("repo", s.repo)}`}
                        className="hover:text-(--foreground)"
                      >
                        {s.repo}
                      </Link>
                    </td>
                    <td className="py-2 px-2 text-right text-(--foreground)">{s.tokensOut.toLocaleString()}</td>
                    <td className="py-2 pl-2 text-right text-(--foreground)">{money(cost)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {hasMore && (
        <div className="text-right">
          <Link
            href={`${base}/sessions?before=${pageRows[pageRows.length - 1].startedAt.toISOString()}${
              sp.source ? `&source=${sp.source}` : ""
            }${sp.intent ? `&intent=${sp.intent}` : ""}${sp.repo ? `&repo=${sp.repo}` : ""}`}
            className="mk-table-cell text-(--accent) hover:underline"
          >
            Next {PAGE_SIZE} →
          </Link>
        </div>
      )}
    </div>
  );
}
