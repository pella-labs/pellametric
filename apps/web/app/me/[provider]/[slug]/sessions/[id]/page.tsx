// F3.28 / H1 — Session detail. Plaintext prompts are NO LONGER server-rendered;
// the client component PromptsLoader fetches them on demand from
// /api/me/sessions/[id]/prompts (rate-limited, owner-only, Cache-Control:
// no-store). HTML response body now contains only encrypted-count metadata.

import { notFound } from "next/navigation";
import Link from "next/link";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { and, eq, sql } from "drizzle-orm";
import { requireMembership } from "@/lib/auth-middleware";
import { SourceChip } from "@/components/data/source-chip";
import { PromptsLoader } from "@/components/insights/prompts-loader";
import { costFor } from "@/lib/pricing";

export const dynamic = "force-dynamic";

function money(x: number): string {
  if (x >= 1000) return `$${(x / 1000).toFixed(1)}K`;
  return `$${x.toFixed(2)}`;
}

export default async function Page({
  params,
}: {
  params: Promise<{ provider: string; slug: string; id: string }>;
}) {
  const { provider, slug, id } = await params;
  const memb = await requireMembership(slug, { provider });
  if (memb instanceof Response) {
    return <div className="p-8 mk-table-cell">Access denied.</div>;
  }
  const session = await auth.api.getSession({ headers: await headers() });
  const userId = session?.user?.id;
  if (!userId) return <div className="p-8 mk-table-cell">Not signed in.</div>;

  const sessRow = await db.query.sessionEvent.findFirst({
    where: and(eq(schema.sessionEvent.id, id), eq(schema.sessionEvent.userId, userId)),
  });
  if (!sessRow) notFound();

  // Count encrypted prompts WITHOUT decrypting. The server-render HTML carries
  // no plaintext from this point on.
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.promptEvent)
    .where(
      and(
        eq(schema.promptEvent.userId, userId),
        eq(schema.promptEvent.source, sessRow.source),
        eq(schema.promptEvent.externalSessionId, sessRow.externalSessionId),
      ),
    );

  const wallSec = Math.max(0, Math.round((sessRow.endedAt.getTime() - sessRow.startedAt.getTime()) / 1000));
  const cost = costFor(sessRow.model, {
    tokensIn: sessRow.tokensIn,
    tokensOut: sessRow.tokensOut,
    tokensCacheRead: sessRow.tokensCacheRead,
    tokensCacheWrite: sessRow.tokensCacheWrite,
  });
  const base = `/me/${provider}/${slug}`;

  return (
    <div className="p-6 space-y-6">
      <div>
        <Link
          href={base}
          className="mk-table-cell text-(--muted-foreground) hover:text-(--foreground)"
        >
          ← back to overview
        </Link>
        <h1 className="mk-heading text-xl mt-2">
          Session {sessRow.externalSessionId.slice(0, 12)}…
        </h1>
        <p className="mk-table-cell text-(--muted-foreground) flex flex-wrap items-center gap-3 mt-1">
          <SourceChip kind={sessRow.source as "claude" | "codex" | "cursor"} showLabel />
          <span>{sessRow.repo}</span>
          <span>{sessRow.startedAt.toISOString().slice(0, 16).replace("T", " ")}</span>
          <span>· {Math.round(wallSec / 60)}m wall</span>
          {sessRow.intentTop && <span>· intent: {sessRow.intentTop}</span>}
        </p>
      </div>

      <section className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Tile label="Tokens in" value={sessRow.tokensIn.toLocaleString()} />
        <Tile label="Tokens out" value={sessRow.tokensOut.toLocaleString()} />
        <Tile label="Cache R / W" value={`${(sessRow.tokensCacheRead / 1000).toFixed(1)}K / ${(sessRow.tokensCacheWrite / 1000).toFixed(1)}K`} />
        <Tile label="Cost" value={money(cost)} />
        <Tile label="Messages" value={String(sessRow.messages)} />
      </section>

      <PromptsLoader sessionId={sessRow.id} encryptedCount={count} />
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="mk-panel">
      <p className="mk-label">{label}</p>
      <p className="mk-stat-numeric text-(--foreground) mt-1">{value}</p>
    </div>
  );
}
