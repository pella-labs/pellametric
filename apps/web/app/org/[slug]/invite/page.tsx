"use client";
import { use, useEffect, useState } from "react";
import Link from "next/link";
import BackButton from "@/components/back-button";

export default function InvitePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const [invites, setInvites] = useState<any[]>([]);
  const [login, setLogin] = useState("");
  const [role, setRole] = useState<"manager" | "dev">("dev");
  const [msg, setMsg] = useState("");

  async function load() {
    const r = await fetch(`/api/invite?orgSlug=${slug}`);
    const j = await r.json();
    setInvites(j.invites ?? []);
  }
  useEffect(() => { load(); }, []);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!login.trim()) return;
    setMsg("Sending…");
    const r = await fetch("/api/invite", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgSlug: slug, githubLogin: login.trim(), role }),
    });
    const j = await r.json();
    if (!r.ok) { setMsg(j.error ?? "failed"); return; }
    setLogin("");
    if (j.github?.ok) {
      const note =
        j.github.status === "already_member" ? "already in the GitHub org" :
        j.github.status === "active" ? "added to the GitHub org" :
        "GitHub invite sent";
      setMsg(`Invited · ${note}`);
    } else if (j.github && !j.github.ok) {
      setMsg(`Invited (pellametric only) · GitHub: ${j.github.error}`);
    } else {
      setMsg("Invited");
    }
    load();
  }

  return (
    <main className="max-w-xl mx-auto mt-8 px-6 pb-16">
      <header className="flex items-start gap-4 mb-6">
        <BackButton href={`/org/${slug}`} />
        <div>
          <h1 className="text-xl font-bold">Invite to {slug}</h1>
          <p className="text-sm text-muted-foreground mt-1">Invited devs need to be in the GitHub org and sign in here with GitHub to accept.</p>
        </div>
      </header>

      <form onSubmit={send} className="flex gap-2 mb-8">
        <input
          value={login}
          onChange={e => setLogin(e.target.value)}
          placeholder="github login (e.g. alice)"
          className="flex-1 h-10 px-3 rounded-md bg-card border border-border text-sm leading-none focus:outline-none focus:border-accent transition"
        />
        <select
          value={role}
          onChange={e => setRole(e.target.value as "manager" | "dev")}
          className="h-10 px-3 rounded-md bg-card border border-border text-sm leading-none focus:outline-none focus:border-accent transition"
        >
          <option value="dev">Dev</option>
          <option value="manager">Manager</option>
        </select>
        <button className="h-10 px-4 rounded-md bg-accent text-accent-foreground mk-label leading-none hover:opacity-90 transition">Invite</button>
      </form>
      {msg && <p className="text-xs text-muted-foreground mb-4">{msg}</p>}

      <h2 className="mk-eyebrow mb-3">Pending + accepted</h2>
      <ul className="space-y-1 text-sm">
        {invites.length === 0 && <li className="text-muted-foreground text-xs">No invites yet.</li>}
        {invites.map(i => (
          <li key={i.id} className="flex justify-between bg-card border border-border rounded-md px-3 py-2">
            <span className="flex items-center gap-2">
              {i.githubLogin}
              <span className="text-xs text-muted-foreground">· {i.role ?? "dev"}</span>
            </span>
            <span className={"text-xs " + (i.status === "accepted" ? "text-positive" : "text-warning")}>{i.status}</span>
          </li>
        ))}
      </ul>
    </main>
  );
}
