import { activityOverview, codeDelivery, cohortFilters, sessionsFeed } from "@bematist/api";
import type { Metadata } from "next";
import { Suspense } from "react";
import { getDbClients } from "@/lib/db";
import { resolveEngineerId } from "@/lib/resolve-engineer-id";
import { getSessionCtx } from "@/lib/session";
import { ActivitySection } from "./_components/ActivitySection";
import { DeliverySection } from "./_components/DeliverySection";
import { FilterBar } from "./_components/FilterBar";
import { SessionsSection } from "./_components/SessionsSection";
import { type Filter, parseFilterFromSearchParams } from "./_filter";

export const metadata: Metadata = {
  title: "Dashboard",
};

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function NewDashboardPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const ctx = await getSessionCtx();

  // CH events are keyed on `developers.id` (set by ingest from the mint
  // token), not the Better Auth `users.id` we get from the session. The
  // dashboard filter must use the resolved id or "Just me" returns 0 rows.
  const selfEngineerId = (await resolveEngineerId(ctx.tenant_id, ctx.actor_id)) ?? ctx.actor_id;

  // Resolve the caller's display name so the filter bar can say "you are
  // Walid" instead of "you are a2e84d4a". Fall back to a short hash if PG
  // doesn't have a name on file.
  const { pg } = getDbClients();
  const meRows = await pg
    .query<{ name: string | null; email: string | null }>(
      `SELECT bau.name AS name, u.email AS email
         FROM users u
         LEFT JOIN better_auth_user bau ON bau.id = u.better_auth_user_id
        WHERE u.id = $1
        LIMIT 1`,
      [ctx.actor_id],
    )
    .catch(() => []);
  const meName =
    meRows[0]?.name?.trim() || meRows[0]?.email?.split("@")[0] || `${selfEngineerId.slice(0, 8)}`;

  const filter = parseFilterFromSearchParams(params, selfEngineerId);

  // Cohorts are small and the filter bar needs them synchronously (repo /
  // engineer picker). Everything else is heavy CH/PG aggregation — stream
  // those behind Suspense so the shell renders immediately on navigation
  // and each section fills in as its own query returns. Before: the page
  // awaited all four in Promise.all, so user-perceived latency was the
  // slowest query every click.
  const cohorts = await cohortFilters(ctx);

  return (
    <div className="newdash">
      <header className="newdash-head">
        <h1 className="newdash-h1">Dashboard</h1>
        <p className="newdash-sub">Activity, code delivery, and sessions — filtered together.</p>
      </header>
      <FilterBar filter={filter} cohorts={cohorts} myEngineerId={selfEngineerId} myName={meName} />
      <Suspense fallback={<SectionSkeleton title="Activity" rows={2} />}>
        <ActivitySectionAsync filter={filter} />
      </Suspense>
      <Suspense fallback={<SectionSkeleton title="Code delivery" rows={3} />}>
        <DeliverySectionAsync filter={filter} />
      </Suspense>
      <Suspense fallback={<SectionSkeleton title="Sessions" rows={4} />}>
        <SessionsSectionAsync filter={filter} />
      </Suspense>
    </div>
  );
}

async function ActivitySectionAsync({ filter }: { filter: Filter }) {
  const ctx = await getSessionCtx();
  const activity = await activityOverview(ctx, filter);
  return <ActivitySection data={activity} window={filter.window} />;
}

async function DeliverySectionAsync({ filter }: { filter: Filter }) {
  const ctx = await getSessionCtx();
  const delivery = await codeDelivery(ctx, filter);
  return <DeliverySection data={delivery} />;
}

async function SessionsSectionAsync({ filter }: { filter: Filter }) {
  const ctx = await getSessionCtx();
  const feedPage = await sessionsFeed(ctx, { ...filter, page_size: 50 });
  return <SessionsSection initial={feedPage} filter={filter} />;
}

function SectionSkeleton({ title, rows }: { title: string; rows: number }) {
  return (
    <section className="newdash-section newdash-section--skeleton" aria-busy="true">
      <h2>{title}</h2>
      <div className="newdash-kpi-row">
        {Array.from({ length: 4 }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length static placeholder
          <div key={i} className="newdash-card newdash-card--skeleton">
            <span className="newdash-skel newdash-skel--label" />
            <span className="newdash-skel newdash-skel--value" />
          </div>
        ))}
      </div>
      <div className="newdash-card newdash-card--skeleton">
        {Array.from({ length: rows }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length static placeholder
          <span key={i} className="newdash-skel newdash-skel--row" />
        ))}
      </div>
    </section>
  );
}
