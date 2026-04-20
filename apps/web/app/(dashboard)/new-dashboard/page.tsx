import { activityOverview, codeDelivery, cohortFilters, sessionsFeed } from "@bematist/api";
import type { Metadata } from "next";
import { resolveEngineerId } from "@/lib/resolve-engineer-id";
import { getSessionCtx } from "@/lib/session";
import { ActivitySection } from "./_components/ActivitySection";
import { DeliverySection } from "./_components/DeliverySection";
import { FilterBar } from "./_components/FilterBar";
import { SessionsSection } from "./_components/SessionsSection";
import { parseFilterFromSearchParams } from "./_filter";

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

  const filter = parseFilterFromSearchParams(params, selfEngineerId);

  const [activity, delivery, cohorts, feedPage] = await Promise.all([
    activityOverview(ctx, filter),
    codeDelivery(ctx, filter),
    cohortFilters(ctx),
    sessionsFeed(ctx, { ...filter, page_size: 50 }),
  ]);

  return (
    <div className="newdash">
      <header className="newdash-head">
        <h1 className="newdash-h1">Dashboard</h1>
        <p className="newdash-sub">Activity, code delivery, and sessions — filtered together.</p>
      </header>
      <FilterBar filter={filter} cohorts={cohorts} myEngineerId={selfEngineerId} />
      <ActivitySection data={activity} window={filter.window} />
      <DeliverySection data={delivery} />
      <SessionsSection initial={feedPage} filter={filter} />
    </div>
  );
}
