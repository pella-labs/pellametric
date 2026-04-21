import { auth } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import Link from "next/link";
import SignOutButton from "@/components/sign-out-button";

export default async function Dashboard() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) redirect("/");

  const memberships = await db
    .select({ org: schema.org, role: schema.membership.role })
    .from(schema.membership)
    .innerJoin(schema.org, eq(schema.membership.orgId, schema.org.id))
    .where(eq(schema.membership.userId, session.user.id));

  return (
    <main className="max-w-5xl mx-auto mt-16 px-6 pb-16">
      <header className="flex items-end justify-between mb-12 pb-6 border-b border-border">
        <div>
          <div className="mk-eyebrow mb-2">pella-metrics</div>
          <h1 className="mk-heading text-3xl md:text-4xl font-semibold tracking-[-0.02em]">
            Welcome back,{" "}
            <em className="not-italic text-accent">{session.user.name?.split(" ")[0] ?? "dev"}.</em>
          </h1>
        </div>
        <SignOutButton />
      </header>

      {memberships.length === 0 ? (
        <section className="mk-card p-8">
          <div className="mk-eyebrow mb-3">no org yet</div>
          <h2 className="mk-heading text-xl font-semibold mb-2">Connect your first org</h2>
          <p className="text-sm text-muted-foreground mb-6 max-w-md">Bring in a GitHub org you manage, or accept an invitation that was sent to your login.</p>
          <Link href="/setup/org" className="mk-label inline-block bg-accent text-accent-foreground px-4 py-2.5 hover:opacity-90 transition">
            Connect an org →
          </Link>
        </section>
      ) : (
        <section>
          <div className="mk-eyebrow mb-4">your orgs</div>
          <div className="border border-border">
            {memberships.map(({ org, role }, i) => (
              <Link
                key={org.id}
                href={`/org/${org.slug}`}
                className={`flex justify-between items-center px-5 py-5 hover:bg-card transition ${i > 0 ? "border-t border-border" : ""}`}
              >
                <div>
                  <div className="mk-heading font-semibold">{org.name}</div>
                  <div className="mk-label mt-1">{org.slug} · {role}</div>
                </div>
                <span className="text-accent mk-label">open →</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="mt-12 mk-card p-6">
        <div className="flex items-start justify-between gap-6">
          <div>
            <div className="mk-eyebrow mb-2">collector</div>
            <h2 className="mk-heading font-semibold text-lg mb-1.5">Run it once</h2>
            <p className="text-sm text-muted-foreground max-w-md">Reads your local Claude Code + Codex sessions, uploads to pella-metrics.</p>
          </div>
          <Link href="/setup/collector" className="mk-label border border-border px-3 py-2 hover:border-[color:var(--border-hover)] transition shrink-0">
            setup →
          </Link>
        </div>
      </section>
    </main>
  );
}
