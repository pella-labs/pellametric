import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import SignInButton from "@/components/sign-in-button";

export default async function Home() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (session?.user) redirect("/dashboard");

  return (
    <div className="relative min-h-screen overflow-hidden">
      <div aria-hidden className="absolute inset-0 mk-grid-bg pointer-events-none" />

      <main className="relative max-w-[1160px] mx-auto px-8 pt-24 md:pt-32 pb-16">
        <div className="grid md:grid-cols-[1.05fr_1fr] gap-12 items-start">
          <section>
            <div className="mk-eyebrow mb-6">pella-metrics · dev productivity, org-scoped</div>

            <h1 className="mk-heading text-5xl md:text-6xl font-semibold leading-[1.05] tracking-[-0.02em]">
              Measure what your team actually{" "}
              <em className="not-italic text-accent">ships.</em>
            </h1>

            <p className="mt-6 text-base md:text-lg text-muted-foreground max-w-[52ch] leading-relaxed">
              Per-dev productivity from your Claude Code and Codex sessions — tokens, tools, skills,
              repos — reconciled with your GitHub org. Runs locally, uploads over HTTPS, you own the data.
            </p>

            <div className="mt-10 flex gap-3 items-center">
              <SignInButton />
              <span className="mk-label">or</span>
              <a
                href="https://github.com/settings/developers"
                target="_blank"
                rel="noreferrer"
                className="mk-label border border-border px-3 py-2 hover:border-[color:var(--border-hover)] transition"
              >
                self-host →
              </a>
            </div>

            <div className="mt-16 grid grid-cols-3 gap-0 mk-frame">
              <Stat label="sessions / week" value="2,400+" />
              <Stat label="tokens tracked" value="18M" />
              <Stat label="repos wired" value="∞" />
            </div>
          </section>

          <section className="relative">
            <div className="mk-card p-6">
              <div className="flex items-center justify-between mb-4">
                <span className="mk-eyebrow">team · last 7 days</span>
                <span className="mk-label text-accent">live</span>
              </div>

              <div className="mk-hero-numeric">3.1<span style={{ color: "var(--warning)" }}>M</span></div>
              <div className="mk-label mt-2">output tokens</div>

              <div className="mt-8 space-y-0 border-t border-border">
                <Row k="active hours" v="147.3h" />
                <Row k="sessions" v="284" />
                <Row k="avg cache hit" v="71%" />
                <Row k="waste spotted" v={<span className="text-destructive">412K</span>} />
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-t border-border px-4 py-5">
      <div className="mk-numeric text-2xl md:text-3xl text-foreground">{value}</div>
      <div className="mk-label mt-1">{label}</div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-border last:border-b-0">
      <span className="mk-label">{k}</span>
      <span className="mk-numeric text-sm text-foreground">{v}</span>
    </div>
  );
}
