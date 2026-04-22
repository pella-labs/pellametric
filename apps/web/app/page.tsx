import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import SignInButton from "@/components/sign-in-button";

export default async function Home() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (session?.user) redirect("/dashboard");

  return (
    <div className="relative min-h-screen overflow-hidden flex flex-col">
      <div aria-hidden className="absolute inset-0 mk-grid-bg pointer-events-none opacity-60" />

      {/* Top brand strip */}
      <header className="relative max-w-[1160px] mx-auto w-full px-8 pt-8">
        <div className="mk-eyebrow">pella-metrics</div>
      </header>

      {/* Hero — single centered column */}
      <main className="relative flex-1 flex items-center justify-center px-8 py-16">
        <section className="max-w-[720px] text-center">
          <h1 className="mk-heading text-5xl md:text-6xl font-semibold leading-[1.05] tracking-[-0.02em]">
            Measure what your team<br />
            actually <em className="not-italic text-accent">ships.</em>
          </h1>

          <p className="mt-6 text-base md:text-lg text-muted-foreground leading-relaxed max-w-[56ch] mx-auto">
            Per-dev productivity from your Claude Code and Codex sessions — tokens, tools, skills,
            repos — reconciled with your GitHub org.
          </p>

          <div className="mt-10 flex justify-center">
            <SignInButton size="lg" />
          </div>

          <p className="mt-4 text-xs text-muted-foreground">
            Only GitHub sign-in · we request <code className="font-mono">read:org</code> and <code className="font-mono">repo</code> to scope data to your orgs.
          </p>
        </section>
      </main>

      {/* Bottom value strip — spaced out, less cluttered */}
      <footer className="relative border-t border-border bg-card/30">
        <div className="max-w-[1160px] mx-auto px-8 py-10 grid grid-cols-1 md:grid-cols-3 gap-8">
          <Strip
            eyebrow="local first"
            title="Runs on your machine"
            body="Collector parses ~/.claude and ~/.codex locally, resolves repos via git remote, uploads only org-scoped sessions."
          />
          <Strip
            eyebrow="org scoped"
            title="Personal work stays private"
            body="Data is filtered by the GitHub orgs you're in. Personal repos never leave your laptop."
          />
          <Strip
            eyebrow="for managers"
            title="Team digest + drill-in"
            body="One glanceable table per team. Click a dev → PRs, skills, MCP, tools, files — all their work in context."
          />
        </div>
      </footer>
    </div>
  );
}

function Strip({ eyebrow, title, body }: { eyebrow: string; title: string; body: string }) {
  return (
    <div>
      <div className="mk-eyebrow mb-2">{eyebrow}</div>
      <div className="mk-heading text-base font-semibold mb-1.5">{title}</div>
      <p className="text-xs text-muted-foreground leading-relaxed">{body}</p>
    </div>
  );
}
