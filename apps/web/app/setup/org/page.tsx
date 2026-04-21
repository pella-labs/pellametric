"use client";
import { useEffect, useState } from "react";

export default function SetupOrgPage() {
  const [orgs, setOrgs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    fetch("/api/orgs").then(r => r.json()).then(d => {
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
    if (r.ok) window.location.href = `/org/${j.org.slug}`;
    else setMsg(j.error ?? "failed");
  }

  return (
    <main className="max-w-xl mx-auto mt-16 px-6">
      <h1 className="text-xl font-bold mb-4">Connect a GitHub org</h1>
      <p className="text-sm text-muted-foreground mb-6">You'll become the manager of this org's workspace. You can invite teammates next.</p>
      {loading ? <p className="text-sm text-muted-foreground">Loading orgs…</p> :
        orgs.length === 0 ? <p className="text-sm text-muted-foreground">No orgs found on your GitHub account.</p> :
        <div className="space-y-2">
          {orgs.map(o => (
            <button key={o.id} onClick={() => claim(o)} className="w-full text-left bg-card border border-border rounded-md p-3 hover:border-primary transition">
              <div className="font-medium">{o.login}</div>
              <div className="text-xs text-muted-foreground">id: {o.id}</div>
            </button>
          ))}
        </div>
      }
      {msg && <p className="text-xs mt-4 text-muted-foreground">{msg}</p>}
    </main>
  );
}
