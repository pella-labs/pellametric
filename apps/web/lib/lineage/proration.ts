// Hot-path §4.2 — daily-stats proration across UTC date boundaries (verbatim).

// SESSION_CAP mirrors apps/web/lib/aggregate.ts — sessions left open overnight
// shouldn't count as 12h of work. 2 hours in seconds.
const SESSION_CAP_SEC = 2 * 3600;

export type SessionForProration = {
  startedAt: Date;
  endedAt: Date;
  tokensOut: number;
  messages: number;
  errors: number;
  teacherMoments: number;
  frustrationSpikes: number;
};

export type ProratedDay = {
  day: string;                  // ISO YYYY-MM-DD (UTC)
  activeSecondsClipped: number;
  messages: number;
  errors: number;
  teacherMoments: number;
  frustrationSpikes: number;
  tokensOut: number;            // non-zero only on startedAt day
};

function utcDayString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function startOfNextUtcDay(d: Date): Date {
  const n = new Date(d);
  n.setUTCHours(24, 0, 0, 0);
  return n;
}

/**
 * Splits a session at UTC midnight boundaries (P12). Per-day metrics
 * (messages, errors, teacherMoments, frustrationSpikes) are prorated
 * linearly by the share of clipped active time each day receives. Tokens
 * stay whole on startedAt's day — they are an integer and aren't a "rate".
 *
 * The total active time considered is clipped to SESSION_CAP_SEC (2h)
 * relative to startedAt, matching aggregate.ts's invariant.
 */
export function prorateSessionAcrossDays(session: SessionForProration): ProratedDay[] {
  const startMs = session.startedAt.getTime();
  const endRawMs = session.endedAt.getTime();
  const endCapMs = Math.min(endRawMs, startMs + SESSION_CAP_SEC * 1000);
  if (endCapMs <= startMs) {
    return [{
      day: utcDayString(session.startedAt),
      activeSecondsClipped: 0,
      messages: session.messages,
      errors: session.errors,
      teacherMoments: session.teacherMoments,
      frustrationSpikes: session.frustrationSpikes,
      tokensOut: session.tokensOut,
    }];
  }

  const totalSec = (endCapMs - startMs) / 1000;
  const slices: { day: string; sec: number }[] = [];

  let cursor = new Date(startMs);
  while (cursor.getTime() < endCapMs) {
    const nextBoundary = startOfNextUtcDay(cursor).getTime();
    const sliceEnd = Math.min(nextBoundary, endCapMs);
    slices.push({ day: utcDayString(cursor), sec: (sliceEnd - cursor.getTime()) / 1000 });
    cursor = new Date(sliceEnd);
  }

  const startDay = utcDayString(session.startedAt);
  return slices.map(s => {
    const share = totalSec > 0 ? s.sec / totalSec : 0;
    return {
      day: s.day,
      activeSecondsClipped: Math.round(s.sec),
      messages: Math.round(session.messages * share),
      errors: Math.round(session.errors * share),
      teacherMoments: Math.round(session.teacherMoments * share),
      frustrationSpikes: Math.round(session.frustrationSpikes * share),
      tokensOut: s.day === startDay ? session.tokensOut : 0,
    };
  });
}
