import { auth } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { and, eq, gte, inArray } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import BackButton from "@/components/back-button";
import { insightsRevampEnabled } from "@/lib/feature-flags";
import { getManagerOverviewData } from "@/lib/insights/manager-overview-data";
import { ManagerOverview } from "@/components/insights/manager-overview";
import { type TeamRow } from "@/components/team-tables";
import OrgViewSwitcher from "@/components/org-view-switcher";
import WindowPicker from "@/components/window-picker";
import { windowCutoff, parseWindow, type WindowKey } from "@/lib/window";
import { aggregateBoth } from "@/lib/aggregate";
import { costFor } from "@/lib/pricing";
import { prAggForMember } from "@/lib/gh";
import { getProvider, ProviderError } from "@/lib/providers";
import { appConfigured, installUrl } from "@/lib/github-app";
import { computeOnboardingState } from "@/lib/onboarding";
import OnboardingOverlay from "@/components/onboarding-overlay";
import { providers } from "@/lib/providers/ui-config";
import type { ProviderName } from "@/lib/providers/types";
import { gitlabCanWrite } from "@/lib/providers/scopes";
import OrgActionsMenu from "@/components/org-actions-menu";

export default async function OrgPage({
  params, searchParams,
}: {
  params: Promise<{ provider: string; slug: string }>;
  searchParams: Promise<{ window?: string }>;
}) {
  const { provider: providerParam, slug } = await params;
  if (providerParam !== "github" && providerParam !== "gitlab") notFound();
  const providerName = providerParam as ProviderName;
  const sp = await searchParams;
  const windowKey: WindowKey = parseWindow(sp.window);
  const cutoff = windowCutoff(windowKey);
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) redirect("/");

  const [row] = await db
    .select({ org: schema.org, role: schema.membership.role })
    .from(schema.membership)
    .innerJoin(schema.org, eq(schema.membership.orgId, schema.org.id))
    .where(and(
      eq(schema.membership.userId, session.user.id),
      eq(schema.org.slug, slug),
      eq(schema.org.provider, providerName),
    ))
    .limit(1);
  if (!row) notFound();
  const isManager = row.role === "manager";

  // F3.20 — when the revamp flag is on, render the new design-council overview
  // and stop. The legacy view below stays untouched for flag-off rollouts.
  if (insightsRevampEnabled()) {
    const data = await getManagerOverviewData(row.org.id, 30);
    return (
      <ManagerOverview
        base={`/org/${providerName}/${slug}`}
        windowLabel={data.windowLabel}
        kpi={data.kpi}
        scatter={data.scatter}
        attribution={data.attribution}
        topPrs={data.topPrs}
        topDevs={data.topDevs}
        backfill={data.backfill}
      />
    );
  }
  const providerCfg = providers[providerName];

  // For GitLab orgs, check whether the stored GAT has write scope. If not, we
  // hide invite-from-Pellametric flows and surface a clear "this is read-only"
  // hint with a path to upgrade the token.
  let canInvite = true;
  if (providerName === "gitlab") {
    const [cred] = await db.select({ scopes: schema.orgCredentials.scopes })
      .from(schema.orgCredentials)
      .where(and(
        eq(schema.orgCredentials.orgId, row.org.id),
        inArray(schema.orgCredentials.kind, ["gitlab_gat", "gitlab_oauth_app"]),
      ))
      .limit(1);
    canInvite = gitlabCanWrite(cred?.scopes ?? null);
  }

  // Build org + window filter (cutoff = null ⇒ no lower bound)
  const orgFilter = eq(schema.sessionEvent.orgId, row.org.id);
  const windowFilter = cutoff ? and(orgFilter, gte(schema.sessionEvent.startedAt, cutoff)) : orgFilter;
  const myFilter = cutoff
    ? and(orgFilter, eq(schema.sessionEvent.userId, session.user.id), gte(schema.sessionEvent.startedAt, cutoff))
    : and(orgFilter, eq(schema.sessionEvent.userId, session.user.id));

  // Parallel: both session queries + the calling user's GitHub account.
  const [allOrgSessions, mySessions] = await Promise.all([
    isManager
      ? db.select().from(schema.sessionEvent).where(windowFilter)
      : Promise.resolve([] as any[]),
    db.select().from(schema.sessionEvent).where(myFilter),
  ]);

  // Team view = everyone including me; Myself = just me
  const teamData = aggregateBoth((isManager ? allOrgSessions : mySessions) as any);
  const myData = aggregateBoth(mySessions as any);

  const onboarding = await computeOnboardingState({
    userId: session.user.id,
    orgId: row.org.id,
    isManager,
    appConfigured: appConfigured(),
    hasInstallationId: providerName === "github" ? row.org.githubAppInstallationId != null : true,
  });

  // ------- Team aggregates (manager only) -------
  let teamRows: TeamRow[] = [];
  if (isManager) {
    // Fetch members and the caller's GitHub token in parallel.
    const [members, [acc]] = await Promise.all([
      db
        .select({ user: schema.user, role: schema.membership.role })
        .from(schema.membership)
        .innerJoin(schema.user, eq(schema.membership.userId, schema.user.id))
        .where(eq(schema.membership.orgId, row.org.id)),
      db.select().from(schema.account)
        .where(and(eq(schema.account.userId, session.user.id), eq(schema.account.providerId, "github")))
        .limit(1),
    ]);

    const byUser = new Map<string, any>();
    const userIntervals = new Map<string, [number, number][]>(); // user -> [[start,end],...] for active-hours calc
    for (const s of allOrgSessions) {
      const key = s.userId;
      const v = byUser.get(key) ?? {
        sessions: 0, tokensIn: 0, tokensOut: 0, tokensCacheRead: 0, tokensCacheWrite: 0,
        costIn: 0, costOut: 0,
        skillSessions: 0, skillTokens: 0, mcpSessions: 0, mcpTokens: 0,
        wasteTokens: 0, teacherMoments: 0, frustrationSpikes: 0,
        errors: 0, lastActive: null as Date | null,
      };
      v.sessions++;
      const tIn = Number(s.tokensIn), tOut = Number(s.tokensOut);
      const tCR = Number(s.tokensCacheRead), tCW = Number(s.tokensCacheWrite);
      v.tokensIn += tIn; v.tokensOut += tOut;
      v.tokensCacheRead += tCR; v.tokensCacheWrite += tCW;
      v.costIn += costFor(s.model, { tokensIn: tIn, tokensOut: 0, tokensCacheRead: tCR, tokensCacheWrite: tCW });
      v.costOut += costFor(s.model, { tokensIn: 0, tokensOut: tOut, tokensCacheRead: 0, tokensCacheWrite: 0 });
      if (Array.isArray(s.skillsUsed) && (s.skillsUsed as any[]).length > 0) { v.skillSessions++; v.skillTokens += tOut; }
      if (Array.isArray(s.mcpsUsed) && (s.mcpsUsed as any[]).length > 0) { v.mcpSessions++; v.mcpTokens += tOut; }
      // Waste proxy: high tokens + 0 files edited (dormant) or very long low-activity (zombie)
      const filesLen = Array.isArray(s.filesEdited) ? (s.filesEdited as any[]).length : 0;
      const durH = (s.endedAt.getTime() - s.startedAt.getTime()) / 3600000;
      if ((tOut >= 10000 && filesLen === 0) || (durH > 4 && s.messages / Math.max(durH, 0.1) < 2)) {
        v.wasteTokens += tOut;
      }
      v.teacherMoments += (s as any).teacherMoments ?? 0;
      v.frustrationSpikes += (s as any).frustrationSpikes ?? 0;
      v.errors += s.errors;
      if (!v.lastActive || s.endedAt > v.lastActive) v.lastActive = s.endedAt;
      byUser.set(key, v);
      if (!userIntervals.has(key)) userIntervals.set(key, []);
      const st = s.startedAt.getTime() / 1000;
      const en = Math.min(s.endedAt.getTime() / 1000, st + 2 * 3600); // cap each session at 2h
      userIntervals.get(key)!.push([st, en]);
    }

    // Active hours per user — merge overlapping capped intervals (no double-count for parallel sessions).
    const userHours = new Map<string, number>();
    for (const [uid, intervals] of userIntervals) {
      intervals.sort((a, b) => a[0] - b[0]);
      let active = 0;
      let [curStart, curEnd] = intervals[0];
      for (let i = 1; i < intervals.length; i++) {
        const [st, en] = intervals[i];
        if (st <= curEnd) {
          curEnd = Math.max(curEnd, en);
        } else {
          active += curEnd - curStart;
          curStart = st; curEnd = en;
        }
      }
      active += curEnd - curStart;
      userHours.set(uid, Math.min(active / 3600, 24 * 30));
    }

    const ghToken = acc?.accessToken ?? null;

    teamRows = await Promise.all(members.map(async m => {
      const agg = byUser.get(m.user.id) ?? {
        sessions: 0, tokensIn: 0, tokensOut: 0, tokensCacheRead: 0, tokensCacheWrite: 0,
        costIn: 0, costOut: 0, skillSessions: 0, skillTokens: 0, mcpSessions: 0, mcpTokens: 0,
        wasteTokens: 0, teacherMoments: 0, frustrationSpikes: 0, errors: 0, lastActive: null,
      };
      let pr = null;
      // Pick the right provider login for each member, then dispatch through
      // the provider abstraction. Falls back to the OAuth-token path for
      // GitHub orgs that haven't installed the App yet.
      const providerLogin = providerName === "gitlab" ? m.user.gitlabUsername : m.user.githubLogin;
      if (providerLogin) {
        try {
          pr = await getProvider(providerName).fetchChangeRequests(row.org.id, providerLogin, cutoff);
        } catch (e) {
          if (providerName === "github" && e instanceof ProviderError && e.code === "permission_denied" && ghToken) {
            // App not installed — legacy OAuth-token PR fetch.
            try { pr = await prAggForMember(row.org.slug, providerLogin, ghToken, cutoff); } catch {}
          }
          // Any other error: leave pr null. Team table renders "—".
        }
      }
      const cacheDenom = agg.tokensCacheRead + agg.tokensIn;
      const cacheHitPct = cacheDenom > 0 ? +((100 * agg.tokensCacheRead) / cacheDenom).toFixed(1) : 0;
      const wastePct = agg.tokensOut > 0 ? +((100 * agg.wasteTokens) / agg.tokensOut).toFixed(1) : 0;
      return {
        userId: m.user.id,
        name: m.user.name,
        login: providerLogin ?? null,
        image: m.user.image,
        orgProvider: providerName,
        orgSlug: row.org.slug,
        ...agg,
        cacheHitPct,
        activeHours: +(userHours.get(m.user.id) ?? 0).toFixed(1),
        lastActive: agg.lastActive ? (agg.lastActive as Date).toISOString() : null,
        wastePct,
        prOpened: pr?.opened, prMerged: pr?.merged, prClosed: pr?.closed,
        prOpenNow: pr?.openNow, additions: pr?.additions, deletions: pr?.deletions,
      } as TeamRow;
    }));

    teamRows.sort((a, b) => b.tokensOut - a.tokensOut);
  }

  return (
    <main className="max-w-[1600px] mx-auto pt-20 sm:pt-24 px-4 sm:px-6 pb-16">
      <header className="flex flex-col gap-4 lg:flex-row lg:justify-between lg:items-start mb-8 sm:mb-10 pb-5 border-b border-border">
        <div className="flex items-start gap-3 sm:gap-4 min-w-0">
          <BackButton href="/dashboard" />
          <div className="min-w-0">
            <div className="mk-eyebrow mb-2 flex items-center gap-2">
              <span style={{ color: providerCfg.accent }} aria-label={`${providerCfg.name} org`}>
                <providerCfg.Icon width={14} height={14} />
              </span>
              <span>{providerCfg.name} · {row.role}</span>
            </div>
            <h1 className="mk-heading text-2xl sm:text-3xl md:text-4xl font-semibold tracking-[-0.02em] break-words">{row.org.name}</h1>
            <div className="mk-label mt-1.5 break-words">
              {row.org.slug}
              <span className="ml-2 text-muted-foreground normal-case tracking-normal">
                · {(isManager ? allOrgSessions.length : mySessions.length).toLocaleString()} sessions in {windowKey === "all" ? "all time" : windowKey}
              </span>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-start gap-2 sm:gap-3">
          <WindowPicker current={windowKey} />
          {isManager && (
            <OrgActionsMenu
              provider={providerName}
              slug={row.org.slug}
              orgName={row.org.name}
              canInvite={canInvite}
            />
          )}
        </div>
      </header>

      {providerName === "github" && isManager && appConfigured() && row.org.githubAppInstallationId == null && installUrl(row.org.slug) && (
        <div className="mb-4 flex items-center justify-between bg-card border border-warning/40 rounded-md px-4 py-3">
          <div className="text-sm">
            <span className="font-medium">Install Pellametric on GitHub.</span>
            <span className="text-muted-foreground ml-2">Enables one-click invites and reliable PR data on the team page.</span>
          </div>
          <a
            href={installUrl(row.org.slug)}
            data-onboarding="install"
            className="text-xs h-8 px-3 leading-8 rounded-md bg-accent text-accent-foreground hover:opacity-90 transition shrink-0"
          >
            Install →
          </a>
        </div>
      )}
      {!onboarding.hasSessions && (
        <div className="mb-8 flex items-center justify-between bg-card border border-border rounded-md px-4 py-3">
          <div className="text-sm">
            <span className="font-medium">Set up your data collector.</span>
            <span className="text-muted-foreground ml-2">Watches your local Claude Code / Codex sessions so this dashboard fills in.</span>
          </div>
          <Link
            href="/setup/collector"
            data-onboarding="collector"
            className="text-xs h-8 px-3 leading-8 rounded-md bg-accent text-accent-foreground hover:opacity-90 transition shrink-0"
          >
            Set up →
          </Link>
        </div>
      )}

      <OnboardingOverlay orgId={row.org.id} activeStep={onboarding.activeStep} />

      <OrgViewSwitcher
        isManager={isManager}
        provider={providerName}
        myData={myData}
        mySessions={(mySessions as any[]).map((s: any) => ({
          id: s.id,
          source: s.source as "claude" | "codex",
          externalSessionId: s.externalSessionId,
          repo: s.repo,
          startedAt: s.startedAt.toISOString(),
          intentTop: s.intentTop,
          messages: s.messages,
          tokensOut: Number(s.tokensOut),
          filesEdited: Array.isArray(s.filesEdited) ? s.filesEdited : [],
          errors: s.errors,
          teacherMoments: s.teacherMoments ?? 0,
          userTurns: s.userTurns,
        }))}
        teamRows={teamRows}
        myName={session.user.name ?? "you"}
      />
    </main>
  );
}
