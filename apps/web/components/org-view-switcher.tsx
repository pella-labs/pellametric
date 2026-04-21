"use client";
import { useState } from "react";
import OrgDashboard from "./org-dashboard";
import TeamTables, { type TeamRow } from "./team-tables";

export default function OrgViewSwitcher({
  isManager,
  myData,
  teamRows,
  myName,
}: {
  isManager: boolean;
  myData: any;
  teamRows: TeamRow[];
  myName: string;
}) {
  const [view, setView] = useState<"team" | "me">(isManager ? "team" : "me");

  if (!isManager) return <OrgDashboard data={myData} />;

  return (
    <div>
      <div className="flex gap-1 mb-6 border-b border-border">
        <TopTab active={view === "team"} label="Team" sub="Everyone in the org" onClick={() => setView("team")} />
        <TopTab active={view === "me"} label={`Myself (${myName})`} sub="Your sessions — charts & data" onClick={() => setView("me")} />
      </div>
      {view === "team" ? <TeamTables rows={teamRows} /> : <OrgDashboard data={myData} />}
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
