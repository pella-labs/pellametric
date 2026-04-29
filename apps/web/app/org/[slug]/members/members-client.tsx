"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

type Member = {
  userId: string;
  name: string;
  login: string | null;
  image: string | null;
  role: "manager" | "dev";
  joinedAt: string;
};

type AuditRow = {
  id: string;
  fromRole: string;
  toRole: string;
  createdAt: string;
  actorName: string;
  actorLogin: string | null;
  targetName: string;
  targetLogin: string | null;
};

export default function MembersClient({
  orgSlug, currentUserId, managerCount, members, audit,
}: {
  orgSlug: string;
  currentUserId: string;
  managerCount: number;
  members: Member[];
  audit: AuditRow[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string>("");

  async function changeRole(targetUserId: string, role: "manager" | "dev") {
    setBusy(targetUserId);
    setErr("");
    const r = await fetch("/api/membership/role", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgSlug, targetUserId, role }),
    });
    setBusy(null);
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      setErr(j.error ?? "failed");
      return;
    }
    router.refresh();
  }

  return (
    <>
      <ul className="space-y-2 mb-8">
        {members.map(m => {
          const isSelf = m.userId === currentUserId;
          const isLastManager = m.role === "manager" && managerCount <= 1;
          const canPromote = m.role === "dev" && !isSelf;
          const canDemote = m.role === "manager" && !isSelf && !isLastManager;
          return (
            <li key={m.userId} className="flex items-center justify-between bg-card border border-border rounded-md px-3 py-2">
              <div className="flex items-center gap-3 min-w-0">
                {m.image ? (
                  <img src={m.image} alt={m.name} className="size-8 rounded-full border border-border object-cover shrink-0" referrerPolicy="no-referrer" />
                ) : (
                  <div className="size-8 rounded-full border border-border bg-popover shrink-0" />
                )}
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{m.name}{isSelf && <span className="text-muted-foreground"> (you)</span>}</div>
                  <div className="text-xs text-muted-foreground truncate">{m.login ?? "—"}</div>
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className={"text-xs px-2 py-1 rounded " + (m.role === "manager" ? "bg-accent/20 text-accent" : "bg-muted/30 text-muted-foreground")}>
                  {m.role}
                </span>
                {canPromote && (
                  <button
                    onClick={() => changeRole(m.userId, "manager")}
                    disabled={busy !== null}
                    className="text-xs h-8 px-3 rounded-md border border-border hover:border-accent transition disabled:opacity-50"
                  >
                    {busy === m.userId ? "…" : "Promote"}
                  </button>
                )}
                {canDemote && (
                  <button
                    onClick={() => changeRole(m.userId, "dev")}
                    disabled={busy !== null}
                    className="text-xs h-8 px-3 rounded-md border border-border hover:border-warning transition disabled:opacity-50"
                  >
                    {busy === m.userId ? "…" : "Demote"}
                  </button>
                )}
                {isSelf && <span className="text-xs text-muted-foreground">—</span>}
                {!isSelf && isLastManager && <span className="text-xs text-muted-foreground">last manager</span>}
              </div>
            </li>
          );
        })}
      </ul>
      {err && <p className="text-xs text-warning mb-4">{err}</p>}

      <h2 className="mk-eyebrow mb-3">Recent role changes</h2>
      {audit.length === 0 ? (
        <p className="text-xs text-muted-foreground">No role changes yet.</p>
      ) : (
        <ul className="space-y-1 text-xs">
          {audit.map(a => (
            <li key={a.id} className="flex justify-between bg-card/50 border border-border rounded-md px-3 py-2">
              <span>
                <span className="font-medium">{a.actorName}</span>
                <span className="text-muted-foreground"> changed </span>
                <span className="font-medium">{a.targetName}</span>
                <span className="text-muted-foreground"> from {a.fromRole} → {a.toRole}</span>
              </span>
              <span className="text-muted-foreground">{new Date(a.createdAt).toLocaleString()}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
