import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getProvider, ProviderError } from "@/lib/providers";
import BackButton from "@/components/back-button";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function GitlabGroupListPage({
  searchParams,
}: {
  searchParams: Promise<{ manual?: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) redirect("/");

  const sp = await searchParams;
  const manualMode = sp.manual === "1";

  const provider = getProvider("gitlab");
  let groups: Awaited<ReturnType<typeof provider.listConnectableOrgs>> = [];
  let errorMsg: string | null = null;
  let needsManual = manualMode;

  if (!manualMode) {
    try {
      groups = await provider.listConnectableOrgs(session.user.id);
    } catch (e) {
      if (e instanceof ProviderError && e.code === "expired_credential") {
        // User isn't signed in via GitLab. Drop into manual mode silently —
        // anyone with a Group Access Token can connect; they don't need to be
        // a GitLab user themselves.
        needsManual = true;
      } else if (e instanceof ProviderError) {
        errorMsg = `Couldn't load groups: ${e.code}`;
      } else {
        errorMsg = "Unexpected error loading GitLab groups.";
      }
    }
  }

  return (
    <main className="max-w-xl mx-auto min-h-[80vh] px-4 sm:px-6 pt-20 sm:pt-24 pb-16">
      <header className="flex items-start gap-3 sm:gap-4 mb-8">
        <BackButton href="/setup/org" />
        <div>
          <h1 className="text-xl font-bold">
            {needsManual ? "Connect a GitLab group" : "Pick a GitLab group"}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {needsManual
              ? "Paste a group path or numeric ID. Then you'll create a Group Access Token in GitLab and paste that on the next step."
              : "Showing groups where you're Maintainer or Owner. Lower roles can't create the access token Telemetryc needs."}
          </p>
        </div>
      </header>

      {errorMsg && <p className="text-sm text-destructive mb-4">{errorMsg}</p>}

      {/* Always-visible recommendation: OAuth Application is the durable path. */}
      <Link
        href="/setup/org/gitlab/oauth"
        className="bg-card border border-border rounded-md p-4 hover:border-accent transition flex items-center gap-3 mb-6"
      >
        <div className="size-10 rounded-md bg-[#fc6d26]/10 flex items-center justify-center text-[#fc6d26] text-lg shrink-0">⌥</div>
        <div className="flex-1 min-w-0">
          <div className="font-medium">Connect via OAuth Application <span className="ml-2 text-[10px] uppercase tracking-wider text-accent">recommended</span></div>
          <div className="text-xs text-muted-foreground mt-0.5">
            One-time GitLab App setup. Tokens auto-refresh. Survives offboarding. Webhooks auto-register.
          </div>
        </div>
        <span className="text-xs uppercase tracking-wider text-[#fc6d26] shrink-0">Setup →</span>
      </Link>

      <div className="flex items-center gap-3 mb-4">
        <div className="h-px flex-1 bg-border" />
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">or use a token (less durable)</span>
        <div className="h-px flex-1 bg-border" />
      </div>

      {needsManual ? (
        <ManualForm />
      ) : (
        <>
          {groups.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              You don't have Maintainer access to any GitLab groups. Create one at{" "}
              <a className="underline" href="https://gitlab.com/groups/new" target="_blank" rel="noopener noreferrer">gitlab.com/groups/new</a>
              {" "}or{" "}
              <Link className="underline" href="/setup/org/gitlab?manual=1">enter a group manually</Link>.
            </p>
          ) : (
            <>
              <div className="border border-border rounded-md divide-y divide-border">
                {groups.map(g => (
                  <Link
                    key={String(g.externalId)}
                    href={`/setup/org/gitlab/${g.externalId}/connect?path=${encodeURIComponent(g.path)}`}
                    className="flex items-center justify-between gap-3 p-4 hover:bg-card transition"
                  >
                    <div className="min-w-0">
                      <div className="font-medium truncate">{g.name}</div>
                      <div className="text-xs text-muted-foreground font-mono truncate">{g.path}</div>
                    </div>
                    <span className="text-xs uppercase tracking-wider text-[#fc6d26] shrink-0">Connect →</span>
                  </Link>
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-4">
                Don't see your group?{" "}
                <Link className="underline" href="/setup/org/gitlab?manual=1">Enter it manually</Link>.
              </p>
            </>
          )}
        </>
      )}
    </main>
  );
}

function ManualForm() {
  return (
    <form action="/setup/org/gitlab/_resolve" method="get" className="flex flex-col gap-3">
      <label className="text-sm">
        <div className="mb-1 text-muted-foreground">Group path or numeric ID</div>
        <input
          name="group"
          required
          minLength={1}
          placeholder="e.g. pella-labs  or  pella-labs/team-a  or  12345"
          className="w-full font-mono text-sm bg-card border border-border rounded-md p-3 focus:outline-none focus:border-accent transition"
        />
      </label>
      <div className="flex gap-2">
        <button
          type="submit"
          className="h-10 px-4 rounded-md bg-accent text-accent-foreground mk-label leading-none hover:opacity-90 transition"
        >
          Continue →
        </button>
        <Link
          href="/setup/org/gitlab"
          className="h-10 px-4 rounded-md border border-border text-sm leading-10 hover:border-[color:var(--border-hover)] transition"
        >
          Use group picker instead
        </Link>
      </div>
      <p className="text-xs text-muted-foreground">
        On the next step, you'll create a Group Access Token in GitLab and paste it. We never see your personal account.
      </p>
    </form>
  );
}
