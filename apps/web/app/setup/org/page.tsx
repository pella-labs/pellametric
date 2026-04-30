import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import BackButton from "@/components/back-button";
import { installUrl, appConfigured } from "@/lib/github-app";

export const dynamic = "force-dynamic";

// Onboarding is now a single step: install the Pellametric GitHub App on a
// GitHub org. The install callback creates the org row, makes the installer
// the first manager, and bounces them to /org/[slug]. This avoids the OAuth
// "grant access to org" footgun where /user/orgs returns empty if the user
// didn't grant per-org access during sign-in.
export default async function SetupOrgPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) redirect("/");

  const url = appConfigured() ? installUrl() : "";

  return (
    <main className="max-w-xl mx-auto min-h-[80vh] px-6 pt-12 pb-16 flex flex-col">
      <header className="flex items-start gap-4 mb-8">
        <BackButton href="/dashboard" />
        <div>
          <h1 className="text-xl font-bold">Connect a GitHub org</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Install Pellametric on your GitHub org. You'll pick which org on the next screen, and become the manager of its workspace once it's installed.
          </p>
        </div>
      </header>

      {url ? (
        <a
          href={url}
          className="bg-card border border-border rounded-md p-4 hover:border-accent transition flex items-center gap-3"
        >
          <div className="size-10 rounded-md bg-accent/10 flex items-center justify-center text-accent text-lg shrink-0">
            ⌘
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-medium">Install Pellametric on GitHub</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              Opens GitHub's install screen. Pick the org you manage, and we'll set everything up automatically.
            </div>
          </div>
          <span className="text-xs uppercase tracking-wider text-accent shrink-0">Install →</span>
        </a>
      ) : (
        <p className="text-sm text-muted-foreground">
          Pellametric isn't configured for GitHub App installs on this server. Ask the operator to set the <code className="text-xs">GITHUB_APP_*</code> env vars.
        </p>
      )}

      <p className="text-xs text-muted-foreground mt-6">
        Already installed Pellametric on your GitHub org from another account? Ask the person who installed it to invite you in pellametric.
      </p>
    </main>
  );
}
