// Phase 3 T3.1 — incremental daily_user_stats rollup.
// For each (userId, orgId, day) recompute the row from session_event using
// prorateSessionAcrossDays for cross-midnight splits (P12).

import { db } from "@/lib/db";
import { sessionEvent, dailyUserStats } from "@/lib/db/schema";
import { and, eq, gte, lt } from "drizzle-orm";
import { prorateSessionAcrossDays } from "@/lib/lineage/proration";

export type Source = "claude" | "codex" | "cursor";

function startOfUtcDay(day: string): Date {
  // 'YYYY-MM-DD' → Date at 00:00 UTC.
  return new Date(`${day}T00:00:00.000Z`);
}

function endOfUtcDay(day: string): Date {
  const start = startOfUtcDay(day);
  return new Date(start.getTime() + 86_400_000);
}

export async function refreshDailyUserStats(
  userId: string,
  orgId: string,
  daysTouched: string[],
): Promise<void> {
  if (daysTouched.length === 0) return;
  const unique = Array.from(new Set(daysTouched));
  for (const day of unique) {
    // Candidate sessions: any whose interval intersects [day_start, day_end).
    const dayStart = startOfUtcDay(day);
    const dayEnd = endOfUtcDay(day);
    // intersect when startedAt < dayEnd AND endedAt >= dayStart
    const sessions = await db
      .select()
      .from(sessionEvent)
      .where(
        and(
          eq(sessionEvent.userId, userId),
          eq(sessionEvent.orgId, orgId),
          lt(sessionEvent.startedAt, dayEnd),
          gte(sessionEvent.endedAt, dayStart),
        ),
      );

    // Bucket by source.
    const buckets = new Map<Source, {
      sessions: number;
      activeSecondsClipped: number;
      tokensIn: number;
      tokensOut: number;
      tokensCacheRead: number;
      tokensCacheWrite: number;
      messages: number;
      errors: number;
      teacherMoments: number;
      frustrationSpikes: number;
    }>();

    for (const s of sessions) {
      const source = s.source as Source;
      const slices = prorateSessionAcrossDays({
        startedAt: s.startedAt,
        endedAt: s.endedAt,
        tokensOut: s.tokensOut,
        messages: s.messages,
        errors: s.errors,
        teacherMoments: s.teacherMoments,
        frustrationSpikes: s.frustrationSpikes,
      });
      const slice = slices.find(sl => sl.day === day);
      if (!slice) continue;
      let b = buckets.get(source);
      if (!b) {
        b = {
          sessions: 0,
          activeSecondsClipped: 0,
          tokensIn: 0,
          tokensOut: 0,
          tokensCacheRead: 0,
          tokensCacheWrite: 0,
          messages: 0,
          errors: 0,
          teacherMoments: 0,
          frustrationSpikes: 0,
        };
        buckets.set(source, b);
      }
      b.sessions += 1;
      b.activeSecondsClipped += slice.activeSecondsClipped;
      // Tokens belong to startedAt's day (P12). Add full token amounts only on that day.
      const startDay = s.startedAt.toISOString().slice(0, 10);
      if (startDay === day) {
        b.tokensIn += s.tokensIn;
        b.tokensOut += s.tokensOut;
        b.tokensCacheRead += s.tokensCacheRead;
        b.tokensCacheWrite += s.tokensCacheWrite;
      }
      b.messages += slice.messages;
      b.errors += slice.errors;
      b.teacherMoments += slice.teacherMoments;
      b.frustrationSpikes += slice.frustrationSpikes;
    }

    for (const [source, b] of buckets) {
      const activeHoursCenti = Math.round((b.activeSecondsClipped / 3600) * 100);
      const values = {
        userId,
        orgId,
        day,
        source,
        sessions: b.sessions,
        activeHoursCenti,
        tokensIn: b.tokensIn,
        tokensOut: b.tokensOut,
        tokensCacheRead: b.tokensCacheRead,
        tokensCacheWrite: b.tokensCacheWrite,
        messages: b.messages,
        errors: b.errors,
        teacherMoments: b.teacherMoments,
        frustrationSpikes: b.frustrationSpikes,
        computedAt: new Date(),
      };
      await db
        .insert(dailyUserStats)
        .values(values)
        .onConflictDoUpdate({
          target: [dailyUserStats.userId, dailyUserStats.orgId, dailyUserStats.day, dailyUserStats.source],
          set: {
            sessions: values.sessions,
            activeHoursCenti: values.activeHoursCenti,
            tokensIn: values.tokensIn,
            tokensOut: values.tokensOut,
            tokensCacheRead: values.tokensCacheRead,
            tokensCacheWrite: values.tokensCacheWrite,
            messages: values.messages,
            errors: values.errors,
            teacherMoments: values.teacherMoments,
            frustrationSpikes: values.frustrationSpikes,
            computedAt: values.computedAt,
          },
        });
    }
  }
}
