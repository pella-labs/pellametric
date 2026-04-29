"use client";
import { useEffect, useState } from "react";
import BackButton from "@/components/back-button";

export default function SetupOrgPage() {
  const [orgs, setOrgs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    fetch("/api/orgs", { cache: "no-store" }).then(r => r.json()).then(d => {
      setOrgs(d.orgs ?? []);
      setLoading(false);
    });
  }, []);

  async function claim(o: any) {
    setMsg("Connecting…");
    const r = await fetch("/api/orgs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ githubOrgId: o.id, slug: o.login, name: o.name }),
    });
    const j = await r.json();
    if (r.ok) {
      // After claim, redirect to install the GitHub App on the same org so PR data
      // and invites are wired in one go. The install callback sends the user back
      // to /org/[slug]?installed=1 once GitHub finishes the install.
      const installRes = await fetch(`/api/github-app/install-url?orgSlug=${j.org.slug}`);
      const inst = await installRes.json().catch(() => ({} as any));
      if (inst?.url) window.location.href = inst.url;
      else window.location.href = `/org/${j.org.slug}`;
    } else setMsg(j.error ?? "failed");
  }

  return (
    <main className="max-w-xl mx-auto min-h-[80vh] px-6 pt-12 pb-16 flex flex-col">
      <header className="flex items-start gap-4 mb-6">
        <BackButton href="/dashboard" />
        <div>
          <h1 className="text-xl font-bold">Connect a GitHub org</h1>
          <p className="text-sm text-muted-foreground mt-1">You'll become the manager of this org's workspace. You can invite teammates next.</p>
        </div>
      </header>
      {loading ? <p className="text-sm text-muted-foreground">Loading orgs…</p> :
        orgs.length === 0 ? <p className="text-sm text-muted-foreground">No orgs found on your GitHub account.</p> :
        <div className="space-y-2">
          {orgs.map(o => (
            <button
              key={o.id}
              onClick={() => !o.connected && claim(o)}
              disabled={o.connected}
              className={`w-full text-left bg-card border border-border rounded-md p-3 flex items-center gap-3 transition ${o.connected ? "opacity-60 cursor-default" : "hover:border-primary"}`}
            >
              {o.avatar ? (
                <img src={o.avatar} alt={o.login} className="size-8 rounded-full border border-border object-cover shrink-0" referrerPolicy="no-referrer" />
              ) : (
                <div className="size-8 rounded-full border border-border bg-popover shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{o.login}</div>
                <div className="text-xs text-muted-foreground">id: {o.id}</div>
              </div>
              {o.connected
                ? <span className="text-[10px] uppercase tracking-wider text-positive font-semibold">connected</span>
                : <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">+ connect</span>}
            </button>
          ))}
        </div>
      }
      {msg && <p className="text-xs mt-4 text-muted-foreground">{msg}</p>}
    </main>
  );
}
