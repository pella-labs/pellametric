// Static demo of the org/[slug] manager view, populated with fake data
// matching the "pella-labs" snapshot. Reuses <TeamTables> verbatim — the
// chrome around it (header, window picker, tabs) is rendered statically
// here since we don't have a session, an org, or a router to wire up.

import type { Metadata } from "next";
import Link from "next/link";
import BackButton from "@/components/back-button";
import TeamTables, { type TeamRow } from "@/components/team-tables";

export const metadata: Metadata = {
  title: "Team snapshot",
  description: "Populated example of the Pellametric team manager dashboard.",
};

const ORG_SLUG = "pella-labs";
const ORG_NAME = "pella-labs";
const TOTAL_SESSIONS = 2158;

const ROWS: TeamRow[] = [
  row({
    userId: "u_sebastian", name: "Sebastian Garces", login: "sebastiangarces",
    sessions: 469, tokensIn: 1_520_000, tokensOut: 25_190_000,
    skillSessions: 6, skillTokens: 3_520_000,
    mcpSessions: 105, mcpTokens: 2_470_000,
    prOpened: 56, prOpenNow: 0, prMerged: 52, prClosed: 4,
    additions: 51_258, deletions: 14_703,
  }),
  row({
    userId: "u_sandesh", name: "Sandesh Pathak", login: "spathak-droid",
    sessions: 1565, tokensIn: 3_530_000, tokensOut: 22_770_000,
    skillSessions: 43, skillTokens: 11_520_000,
    mcpSessions: 62, mcpTokens: 4_730_000,
    prOpened: 18, prOpenNow: 2, prMerged: 16, prClosed: 0,
    additions: 36_837, deletions: 2_804,
  }),
  row({
    userId: "u_walid", name: "walid", login: "vebari",
    sessions: 96, tokensIn: 4_620_000, tokensOut: 12_400_000,
    skillSessions: 2, skillTokens: 383_000,
    mcpSessions: 7, mcpTokens: 2_610_000,
    prOpened: 52, prOpenNow: 3, prMerged: 44, prClosed: 5,
    additions: 266_555, deletions: 33_894,
  }),
  row({
    userId: "u_david", name: "David Aihe", login: "Dvssi",
    sessions: 22, tokensIn: 755_800, tokensOut: 10_870_000,
    skillSessions: 0, skillTokens: 0,
    mcpSessions: 0, mcpTokens: 0,
    prOpened: 15, prOpenNow: 0, prMerged: 14, prClosed: 1,
    additions: 48_814, deletions: 4_577,
  }),
  row({
    userId: "u_jorge", name: "Jorge Alejandro Diez", login: "alediez2840",
    sessions: 7, tokensIn: 11_830_000, tokensOut: 2_780_000,
    skillSessions: 0, skillTokens: 0,
    mcpSessions: 0, mcpTokens: 0,
    prOpened: 20, prOpenNow: 0, prMerged: 17, prClosed: 3,
    additions: 51_355, deletions: 5_340,
  }),
];

export default function TeamSnapshotPage() {
  return (
    <main className="max-w-[1600px] mx-auto mt-8 px-6 pb-16">
      <header className="flex justify-between items-start mb-10 pb-5 border-b border-border">
        <div className="flex items-start gap-4">
          <BackButton href="/" />
          <div>
            <div className="mk-eyebrow mb-2">org · manager</div>
            <h1 className="mk-heading text-3xl md:text-4xl font-semibold tracking-[-0.02em]">{ORG_NAME}</h1>
            <div className="mk-label mt-1.5">
              {ORG_SLUG}
              <span className="ml-2 text-muted-foreground normal-case tracking-normal">
                · {TOTAL_SESSIONS.toLocaleString()} sessions in 30d
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-start gap-3">
          <StaticWindowPicker />
          <Link
            href="#"
            className="mk-label bg-accent text-accent-foreground px-3 py-2 hover:opacity-90 transition"
          >
            Invite →
          </Link>
        </div>
      </header>

      <div className="flex gap-1 mb-6 border-b border-border">
        <StaticTab active label="Team" sub="Everyone in the org" />
        <StaticTab label="Myself (Sebastian Garces)" sub="Your sessions — charts & data" />
      </div>

      <TeamTables rows={ROWS} />
    </main>
  );
}

function StaticWindowPicker() {
  const items = [
    { key: "7d", label: "7d" },
    { key: "30d", label: "30d" },
    { key: "90d", label: "90d" },
    { key: "all", label: "All" },
  ] as const;
  const current = "30d";
  return (
    <div className="inline-flex items-center gap-1 p-1 rounded-md border border-border bg-card">
      {items.map(w => (
        <span
          key={w.key}
          className={`px-3 py-1 rounded text-[11px] font-mono font-semibold transition ${
            current === w.key ? "bg-primary text-primary-foreground" : "text-muted-foreground"
          }`}
        >
          {w.label}
        </span>
      ))}
    </div>
  );
}

function StaticTab({ active, label, sub }: { active?: boolean; label: string; sub: string }) {
  return (
    <div
      className={`px-5 py-3 text-left border-b-2 transition ${
        active ? "border-primary" : "border-transparent"
      }`}
    >
      <div className={`text-sm font-semibold ${active ? "text-primary" : "text-muted-foreground"}`}>{label}</div>
      <div className="text-[10px] text-muted-foreground">{sub}</div>
    </div>
  );
}

// Build a TeamRow from the visible-in-screenshot fields, filling the
// rest with plausible defaults so the row type stays satisfied.
function row(o: {
  userId: string; name: string; login: string;
  sessions: number; tokensIn: number; tokensOut: number;
  skillSessions: number; skillTokens: number;
  mcpSessions: number; mcpTokens: number;
  prOpened: number; prOpenNow: number; prMerged: number; prClosed: number;
  additions: number; deletions: number;
}): TeamRow {
  const costIn = (o.tokensIn / 1e6) * 3;     // Sonnet input rate
  const costOut = (o.tokensOut / 1e6) * 15;  // Sonnet output rate
  return {
    userId: o.userId, name: o.name, login: o.login, image: null,
    orgSlug: ORG_SLUG,
    sessions: o.sessions,
    tokensIn: o.tokensIn, tokensOut: o.tokensOut,
    tokensCacheRead: 0, tokensCacheWrite: 0,
    costIn, costOut,
    skillTokens: o.skillTokens, skillSessions: o.skillSessions,
    mcpTokens: o.mcpTokens, mcpSessions: o.mcpSessions,
    cacheHitPct: 0, activeHours: 0, lastActive: null,
    wasteTokens: 0, wastePct: 0,
    teacherMoments: 0, frustrationSpikes: 0, errors: 0,
    prOpened: o.prOpened, prOpenNow: o.prOpenNow,
    prMerged: o.prMerged, prClosed: o.prClosed,
    additions: o.additions, deletions: o.deletions,
  };
}
