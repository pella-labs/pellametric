import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import BackButton from "@/components/back-button";
import { connectGitlabGroup } from "./actions";

export const dynamic = "force-dynamic";

const GITLAB_ORANGE = "#fc6d26";

export default async function GitlabConnectPage({
  params, searchParams,
}: {
  params: Promise<{ groupId: string }>;
  searchParams: Promise<{ path?: string; error?: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) redirect("/");

  const { groupId } = await params;
  const sp = await searchParams;
  const path = sp.path ?? "";
  const errorMsg = sp.error;

  const tokensUrl = path
    ? `https://gitlab.com/groups/${path}/-/settings/access_tokens`
    : "https://gitlab.com/groups";

  return (
    <main className="max-w-2xl mx-auto pt-20 sm:pt-24 px-4 sm:px-6 pb-20">
      <header className="flex items-start gap-3 sm:gap-4 mb-8">
        <BackButton href="/setup/org/gitlab" />
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <span
              className="inline-flex items-center justify-center w-7 h-7 rounded-full"
              style={{ backgroundColor: `${GITLAB_ORANGE}1f`, border: `1px solid ${GITLAB_ORANGE}59` }}
              aria-hidden
            >
              <GitlabMark />
            </span>
            <span className="mk-label" style={{ color: GITLAB_ORANGE }}>
              GitLab · Group Access Token
            </span>
            {path && (
              <>
                <span className="text-[color:var(--ink-faint)]">·</span>
                <code className="font-mono text-xs text-foreground bg-card border border-border rounded px-2 py-0.5 max-w-full truncate">
                  {path}
                </code>
              </>
            )}
          </div>
          <h1 className="mk-heading text-2xl sm:text-3xl font-semibold tracking-[-0.02em]">
            Paste your Group Access Token
          </h1>
          <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
            A server-side token, not your personal account — the connection survives if you leave the org.
          </p>
        </div>
      </header>

      <ol className="space-y-4 mb-8">
        <Step n={1} title="Open the group's access-token settings">
          <p className="text-sm text-muted-foreground leading-relaxed">
            Go to{" "}
            <a
              className="underline decoration-dotted underline-offset-2 text-foreground hover:text-[color:var(--accent)] transition"
              href={tokensUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              {path || "the group settings"} → Access tokens
            </a>
            . You'll need <strong className="text-foreground">Maintainer</strong> on the group to mint one.
          </p>
        </Step>

        <Step n={2} title="Add a new token">
          <p className="text-sm text-muted-foreground mb-3">
            Click <strong className="text-foreground">Add new token</strong> and pick:
          </p>
          <dl className="space-y-3 text-sm">
            <Field label="Role">
              <span className="text-xs text-muted-foreground inline-flex items-center gap-1.5 flex-wrap">
                <CheckIcon />
                <code className="font-mono bg-card border border-border rounded px-1.5 py-0.5">Reporter</code>
                <span>or higher.</span>
              </span>
            </Field>
            <Field label="Scope">
              <span className="text-xs text-muted-foreground inline-flex items-center gap-1.5 flex-wrap">
                <CheckIcon />
                <code className="font-mono bg-card border border-border rounded px-1.5 py-0.5">read_api</code>
                <span className="text-[color:var(--ink-faint)] mx-1">·</span>
                <span>or pick</span>
                <code className="font-mono bg-card border border-border rounded px-1.5 py-0.5">api</code>
                <span>if you also want to invite members from Telemetryc.</span>
              </span>
            </Field>
          </dl>
        </Step>

        <Step n={3} title="Copy the token and paste below" last>
          <p className="text-sm text-muted-foreground leading-relaxed">
            GitLab shows the token once. We encrypt it at rest with AES-256-GCM and only use it server-side.
          </p>
        </Step>
      </ol>

      {errorMsg && (
        <div className="mb-5 px-4 py-3 rounded-lg border border-destructive/40 bg-destructive/10 text-sm text-destructive">
          {decodeURIComponent(errorMsg)}
        </div>
      )}

      <form action={connectGitlabGroup} className="mk-card p-5 sm:p-6 flex flex-col gap-4 rounded-lg">
        <input type="hidden" name="groupId" value={groupId} />
        <input type="hidden" name="path" value={path} />

        <label className="block">
          <div className="flex items-baseline justify-between mb-1.5">
            <span className="text-sm font-medium text-foreground">Group Access Token</span>
            <span className="text-[11px] font-mono text-muted-foreground">starts with glpat-</span>
          </div>
          <textarea
            name="gat"
            required
            minLength={20}
            rows={3}
            placeholder="glpat-…"
            autoComplete="off"
            spellCheck={false}
            className="w-full font-mono text-sm bg-background/60 border border-border rounded-md px-3 py-2.5 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition placeholder:text-[color:var(--ink-faint)] resize-y"
          />
        </label>

        <div className="flex flex-col-reverse sm:flex-row sm:items-center gap-3">
          <a
            href="/setup/org/gitlab"
            className="mk-label inline-flex items-center justify-center h-11 px-4 rounded-lg border border-border hover:border-[color:var(--border-hover)] transition"
          >
            Cancel
          </a>
          <button
            type="submit"
            className="mk-label inline-flex items-center justify-center gap-2 h-11 px-5 rounded-lg text-white font-medium transition hover:-translate-y-px"
            style={{
              background: `linear-gradient(180deg, ${GITLAB_ORANGE} 0%, #e55a17 100%)`,
              boxShadow: `0 8px 22px -10px ${GITLAB_ORANGE}99`,
            }}
          >
            <GitlabMark />
            <span>Connect group</span>
            <span aria-hidden>→</span>
          </button>
        </div>

        <div className="flex items-start gap-2 text-xs text-muted-foreground border border-border rounded-md px-3 py-2.5 bg-[color:var(--background)]/40">
          <ShieldIcon />
          <span className="leading-relaxed">
            Encrypted at rest with <strong className="text-foreground">AES-256-GCM</strong>. We never log it,
            and you can rotate or revoke it in GitLab any time.
          </span>
        </div>
      </form>
    </main>
  );
}

function Step({ n, title, children, last }: { n: number; title: string; children: React.ReactNode; last?: boolean }) {
  return (
    <li className="flex gap-4">
      <div className="flex flex-col items-center">
        <span className="shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-full border border-border bg-card font-mono text-xs text-foreground">
          {n}
        </span>
        {!last && <span className="w-px flex-1 bg-border mt-2" aria-hidden />}
      </div>
      <div className="flex-1 min-w-0 pb-4">
        <div className="mk-heading font-semibold text-sm mb-1">{title}</div>
        {children}
      </div>
    </li>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-3">
      <dt className="mk-label text-muted-foreground sm:w-20 shrink-0">{label}</dt>
      <dd className="flex-1 min-w-0">{children}</dd>
    </div>
  );
}

function GitlabMark() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden style={{ color: GITLAB_ORANGE }}>
      <path d="M23.6 9.6L23.57 9.5l-3.27-8.5a.85.85 0 0 0-.81-.55.85.85 0 0 0-.81.6l-2.21 6.76H7.54L5.33 1.04A.85.85 0 0 0 4.52.45a.85.85 0 0 0-.81.55L.43 9.5l-.03.1a6.05 6.05 0 0 0 2.01 6.99l.01.01.03.02 4.96 3.72 2.46 1.86 1.5 1.13a1 1 0 0 0 1.21 0l1.5-1.13 2.46-1.86 5-3.74.01-.01A6.05 6.05 0 0 0 23.6 9.6z" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
      <rect x="0.5" y="0.5" width="11" height="11" rx="2" fill="rgba(110, 138, 111, 0.18)" stroke="rgba(110, 138, 111, 0.6)" />
      <path d="M3 6.2l2 2 4-4.2" stroke="#6e8a6f" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden className="text-[color:var(--accent)] shrink-0 mt-0.5">
      <path d="M8 1.5l5.5 2v4.2c0 3.1-2.3 5.9-5.5 6.8-3.2-.9-5.5-3.7-5.5-6.8V3.5L8 1.5z" />
      <path d="M5.8 8.2l1.6 1.6 3-3" />
    </svg>
  );
}
