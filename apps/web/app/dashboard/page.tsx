import { auth } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import Link from "next/link";
import { acceptPendingInvites } from "@/lib/invite-accept";
import type { ProviderName } from "@/lib/providers/types";
import DashboardOrgList from "@/components/dashboard-org-list";

export default async function Dashboard() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) redirect("/");

  // Auto-accept any pending invitations for this user (verifies GitHub org membership)
  await acceptPendingInvites(session.user.id);

  const memberships = await db
    .select({ org: schema.org, role: schema.membership.role })
    .from(schema.membership)
    .innerJoin(schema.org, eq(schema.membership.orgId, schema.org.id))
    .where(eq(schema.membership.userId, session.user.id));

  return (
    <main className="max-w-[1600px] mx-auto pt-20 sm:pt-24 px-4 sm:px-6 pb-16">
      <header className="mb-10 sm:mb-12 pb-5 sm:pb-6 border-b border-border">
        <div className="mk-eyebrow mb-2">telemetryc</div>
        <h1 className="mk-heading text-2xl sm:text-3xl md:text-4xl font-semibold tracking-[-0.02em]">
          Welcome back,{" "}
          <em className="not-italic text-accent">{session.user.name?.split(" ")[0] ?? "dev"}.</em>
        </h1>
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
        <DashboardOrgList
          rows={memberships.map(({ org, role }) => ({
            id: org.id,
            slug: org.slug,
            name: org.name,
            role,
            provider: (org.provider ?? "github") as ProviderName,
          }))}
        />
      )}

      <section className="mt-12 mk-card p-5 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 sm:gap-6">
          <div>
            <div className="mk-eyebrow mb-2">collector</div>
            <h2 className="mk-heading font-semibold text-lg mb-1.5">Run it once</h2>
            <p className="text-sm text-muted-foreground max-w-md">Reads your local Claude Code + Codex sessions, uploads to Telemetryc.</p>
          </div>
          <Link href="/setup/collector" className="mk-label border border-border px-3 py-2 hover:border-[color:var(--border-hover)] transition shrink-0 self-start">
            setup →
          </Link>
        </div>
      </section>
    </main>
  );
}
