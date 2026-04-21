import { auth } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { type TeamRow } from "@/components/team-tables";
import OrgViewSwitcher from "@/components/org-view-switcher";
import { aggregateBoth } from "@/lib/aggregate";
import { costFor } from "@/lib/pricing";
import { prAggForMember } from "@/lib/gh";

export default async function OrgPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) redirect("/");

  const [row] = await db
    .select({ org: schema.org, role: schema.membership.role })
    .from(schema.membership)
    .innerJoin(schema.org, eq(schema.membership.orgId, schema.org.id))
    .where(and(eq(schema.membership.userId, session.user.id), eq(schema.org.slug, slug)))
    .limit(1);
  if (!row) notFound();
  const isManager = row.role === "manager";

  // Always load all org sessions once for managers; devs only see own.
  const allOrgSessions = isManager
    ? await db.select().from(schema.sessionEvent).where(eq(schema.sessionEvent.orgId, row.org.id))
    : [];
  const mySessions = await db.select().from(schema.sessionEvent)
    .where(and(eq(schema.sessionEvent.orgId, row.org.id), eq(schema.sessionEvent.userId, session.user.id)));

  // Team view = everyone including me; Myself = just me
  const teamData = aggregateBoth((isManager ? allOrgSessions : mySessions) as any);
  const myData = aggregateBoth(mySessions as any);

  // ------- Team aggregates (manager only) -------
  let teamRows: TeamRow[] = [];
  if (isManager) {
    const members = await db
      .select({ user: schema.user, role: schema.membership.role })
      .from(schema.membership)
      .innerJoin(schema.user, eq(schema.membership.userId, schema.user.id))
      .where(eq(schema.membership.orgId, row.org.id));

    const byUser = new Map<string, any>();
    const userTimestamps = new Map<string, number[]>();       // user -> [ts,...] for active-hours calc
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
      if (!userTimestamps.has(key)) userTimestamps.set(key, []);
      userTimestamps.get(key)!.push(s.startedAt.getTime() / 1000, s.endedAt.getTime() / 1000);
    }

    // Active hours per user via merged-timeline idle-gap collapse
    const userHours = new Map<string, number>();
    for (const [uid, ts] of userTimestamps) {
      ts.sort((a, b) => a - b);
      let active = 0, prev = ts[0];
      for (let i = 1; i < ts.length; i++) {
        const gap = ts[i] - prev;
        if (gap > 0 && gap < 600) active += gap;
        prev = ts[i];
      }
      userHours.set(uid, Math.min(active / 3600, 24 * 30));
    }

    const [acc] = await db.select().from(schema.account)
      .where(and(eq(schema.account.userId, session.user.id), eq(schema.account.providerId, "github")))
      .limit(1);
    const ghToken = acc?.accessToken ?? null;

    teamRows = await Promise.all(members.map(async m => {
      const agg = byUser.get(m.user.id) ?? {
        sessions: 0, tokensIn: 0, tokensOut: 0, tokensCacheRead: 0, tokensCacheWrite: 0,
        costIn: 0, costOut: 0, skillSessions: 0, skillTokens: 0, mcpSessions: 0, mcpTokens: 0,
        wasteTokens: 0, teacherMoments: 0, frustrationSpikes: 0, errors: 0, lastActive: null,
      };
      let pr = null;
      if (ghToken && m.user.githubLogin) {
        try { pr = await prAggForMember(row.org.slug, m.user.githubLogin, ghToken); } catch {}
      }
      const cacheDenom = agg.tokensCacheRead + agg.tokensIn + agg.tokensCacheWrite;
      const cacheHitPct = cacheDenom > 0 ? +((100 * agg.tokensCacheRead) / cacheDenom).toFixed(1) : 0;
      const wastePct = agg.tokensOut > 0 ? +((100 * agg.wasteTokens) / agg.tokensOut).toFixed(1) : 0;
      return {
        userId: m.user.id,
        name: m.user.name,
        login: m.user.githubLogin,
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
    <main className="max-w-[1600px] mx-auto mt-8 px-6 pb-16">
      <header className="flex justify-between items-end mb-10 pb-5 border-b border-border">
        <div>
          <div className="mk-eyebrow mb-2">org · {row.role}</div>
          <h1 className="mk-heading text-3xl md:text-4xl font-semibold tracking-[-0.02em]">{row.org.name}</h1>
          <div className="mk-label mt-1.5">{row.org.slug}</div>
        </div>
        <div className="flex gap-3 items-center">
          {isManager && (
            <Link href={`/org/${row.org.slug}/invite`} className="mk-label bg-accent text-accent-foreground px-3 py-2 hover:opacity-90 transition">
              Invite →
            </Link>
          )}
          <Link href="/dashboard" className="mk-label border border-border px-3 py-2 hover:border-[color:var(--border-hover)] transition">← back</Link>
        </div>
      </header>

      <OrgViewSwitcher
        isManager={isManager}
        myData={myData}
        teamRows={teamRows}
        myName={session.user.name ?? "you"}
      />
    </main>
  );
}
