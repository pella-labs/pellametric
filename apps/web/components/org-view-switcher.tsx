"use client";
import { useState } from "react";
import OrgDashboard from "./org-dashboard";
import TeamTables, { type TeamRow } from "./team-tables";
import MyProjectSessions from "./my-project-sessions";

type MySess = {
  id: string;
  source: "claude" | "codex";
  externalSessionId: string;
  repo: string;
  startedAt: string;
  intentTop?: string | null;
  messages: number;
  tokensOut: number;
  filesEdited: string[];
  errors: number;
  teacherMoments?: number;
  userTurns?: number;
};

export default function OrgViewSwitcher({
  isManager,
  myData,
  mySessions,
  teamRows,
  myName,
}: {
  isManager: boolean;
  myData: any;
  mySessions: MySess[];
  teamRows: TeamRow[];
  myName: string;
}) {
  const [view, setView] = useState<"team" | "me">(isManager ? "team" : "me");

  const myPanel = (
    <>
      <OrgDashboard data={myData} />
      <MyProjectSessions sessions={mySessions} />
    </>
  );

  if (!isManager) return myPanel;

  return (
    <div>
      <div className="flex gap-1 mb-6 border-b border-border">
        <TopTab active={view === "team"} label="Team" sub="Everyone in the org" onClick={() => setView("team")} />
        <TopTab active={view === "me"} label={`Myself (${myName})`} sub="Your sessions — charts & data" onClick={() => setView("me")} />
      </div>
      {view === "team" ? <TeamTables rows={teamRows} /> : myPanel}
    </div>
  );
}

function TopTab({ active, label, sub, onClick }: any) {
  return (
    <button
      onClick={onClick}
      className={`px-5 py-3 text-left border-b-2 transition ${active ? "border-primary" : "border-transparent hover:bg-popover/40"}`}
    >
      <div className={`text-sm font-semibold ${active ? "text-primary" : "text-muted-foreground"}`}>{label}</div>
      <div className="text-[10px] text-muted-foreground">{sub}</div>
    </button>
  );
}
