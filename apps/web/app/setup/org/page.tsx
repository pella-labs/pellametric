import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import BackButton from "@/components/back-button";
import { installUrl, appConfigured } from "@/lib/github-app";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

// Onboarding chooser. We surface the connect option that matches the user's
// signed-in / linked providers first, since:
//   - GitHub: App install works from anywhere (no need for the user's GitHub OAuth).
//   - GitLab: listing groups requires the user's GitLab OAuth token. Without it,
//     we still allow connect via manual path entry, but the picker is the cleaner
//     UX when the token exists.
export default async function SetupOrgPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) redirect("/");

  // Which providers does this user have linked? Drives card ordering and the
  // GitLab card's primary CTA (picker vs manual entry).
  const accounts = await db.select({ providerId: schema.account.providerId })
    .from(schema.account)
    .where(eq(schema.account.userId, session.user.id));
  const linked = new Set(accounts.map(a => a.providerId));
  const hasGithub = linked.has("github");
  const hasGitlab = linked.has("gitlab");

  const ghUrl = appConfigured() ? installUrl() : "";

  // Primary first, secondary second. If both linked, GitHub first
  // (App-installation tokens are stronger creds than GAT).
  const githubFirst = hasGithub || (!hasGithub && !hasGitlab);

  const githubCard = ghUrl ? (
    <a
      key="github"
      href={ghUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="bg-card border border-border rounded-md p-4 hover:border-accent transition flex items-center gap-3"
    >
      <div className="size-10 rounded-md bg-accent/10 flex items-center justify-center text-accent text-lg shrink-0">⌘</div>
      <div className="flex-1 min-w-0">
        <div className="font-medium">GitHub organization</div>
        <div className="text-xs text-muted-foreground mt-0.5">
          {hasGithub
            ? "Install the Telemetryc App on a GitHub org you manage."
            : "Install the Telemetryc App. You'll authenticate with the org owner's GitHub on the next screen."}
        </div>
      </div>
      <span className="text-xs uppercase tracking-wider text-accent shrink-0">Install →</span>
    </a>
  ) : null;

  const gitlabHref = hasGitlab ? "/setup/org/gitlab" : "/setup/org/gitlab?manual=1";
  const gitlabSubtitle = hasGitlab
    ? "Pick from groups you maintain, then paste a Group Access Token."
    : "Paste a group path or token. You don't need to be a GitLab user yourself.";

  const gitlabCard = (
    <a
      key="gitlab"
      href={gitlabHref}
      className="bg-card border border-border rounded-md p-4 hover:border-accent transition flex items-center gap-3"
    >
      <div className="size-10 rounded-md bg-[#fc6d26]/10 flex items-center justify-center text-[#fc6d26] text-lg shrink-0">⌥</div>
      <div className="flex-1 min-w-0">
        <div className="font-medium">GitLab group</div>
        <div className="text-xs text-muted-foreground mt-0.5">{gitlabSubtitle}</div>
      </div>
      <span className="text-xs uppercase tracking-wider text-[#fc6d26] shrink-0">Connect →</span>
    </a>
  );

  const cards = githubFirst ? [githubCard, gitlabCard] : [gitlabCard, githubCard];

  return (
    <main className="max-w-xl mx-auto min-h-[80vh] px-4 sm:px-6 pt-20 sm:pt-24 pb-16 flex flex-col">
      <header className="flex items-start gap-3 sm:gap-4 mb-8">
        <BackButton href="/dashboard" />
        <div>
          <h1 className="text-xl font-bold">Connect an org</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {hasGithub && hasGitlab
              ? "Choose where your code lives. You'll become the manager of the new workspace."
              : hasGitlab
                ? "Connect a GitLab group from your account. We can also connect a GitHub org via the App install."
                : "Install the Telemetryc App on a GitHub org, or connect a GitLab group via Group Access Token."}
          </p>
        </div>
      </header>

      <div className="flex flex-col gap-3">
        {cards}
      </div>

      {!ghUrl && (
        <p className="text-sm text-muted-foreground mt-4">
          GitHub App is not configured on this server. Set <code className="text-xs">GITHUB_APP_*</code> env vars to enable.
        </p>
      )}

      <p className="text-xs text-muted-foreground mt-6">
        Already connected from another account? Ask the person who connected it to invite you in Telemetryc.
      </p>
    </main>
  );
}
