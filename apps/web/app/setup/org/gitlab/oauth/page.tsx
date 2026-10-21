import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import BackButton from "@/components/back-button";
import CopyButton from "@/components/copy-button";
import { startGitlabOauth } from "./actions";

export const dynamic = "force-dynamic";

const GITLAB_ORANGE = "#fc6d26";

export default async function GitlabOauthSetupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) redirect("/");

  const sp = await searchParams;
  const errorMsg = sp.error;

  // Display the redirect URI the customer must paste into their GitLab OAuth App.
  const baseUrl = (process.env.BETTER_AUTH_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const redirectUri = `${baseUrl}/api/gitlab-oauth/callback`;

  return (
    <main className="max-w-2xl mx-auto pt-20 sm:pt-24 px-4 sm:px-6 pb-20">
      <header className="flex items-start gap-3 sm:gap-4 mb-8">
        <BackButton href="/setup/org/gitlab" />
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <span
              className="inline-flex items-center justify-center w-7 h-7 rounded-full"
              style={{ backgroundColor: `${GITLAB_ORANGE}1f`, border: `1px solid ${GITLAB_ORANGE}59` }}
              aria-hidden
            >
              <GitlabMark />
            </span>
            <span className="mk-label" style={{ color: GITLAB_ORANGE }}>GitLab · OAuth Application</span>
          </div>
          <h1 className="mk-heading text-2xl sm:text-3xl font-semibold tracking-[-0.02em]">
            Connect via OAuth
          </h1>
          <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
            One-time setup. Tokens auto-refresh and survive if you leave the org —
            we never store a long-lived secret after this.
          </p>
        </div>
      </header>

      <ol className="space-y-4 mb-8">
        <Step n={1} title="Open GitLab Applications">
          <p className="text-sm text-muted-foreground leading-relaxed">
            Head to{" "}
            <a
              className="underline decoration-dotted underline-offset-2 text-foreground hover:text-[color:var(--accent)] transition"
              href="https://gitlab.com/-/user_settings/applications"
              target="_blank"
              rel="noopener noreferrer"
            >
              Edit profile → Applications
            </a>{" "}
            (or your group's <em className="not-italic text-foreground">Settings → Applications</em> for a group-owned App).
          </p>
        </Step>

        <Step n={2} title="Add a new application">
          <p className="text-sm text-muted-foreground mb-3">Click <strong className="text-foreground">Add new application</strong> and fill in:</p>
          <dl className="space-y-3 text-sm">
            <Field label="Name">
              <span className="font-mono text-xs bg-card border border-border rounded px-2 py-1">Telemetryc</span>
              <span className="text-xs text-muted-foreground ml-2">(or anything you like)</span>
            </Field>
            <Field label="Redirect URI">
              <div className="flex items-stretch gap-2 w-full">
                <code className="flex-1 bg-card border border-border rounded-md px-3 py-2 font-mono text-xs text-foreground break-all leading-relaxed select-all min-w-0">
                  {redirectUri}
                </code>
                <CopyButton text={redirectUri} label="copy URI" />
              </div>
            </Field>
            <Field label="Confidential">
              <span className="text-xs text-muted-foreground inline-flex items-center gap-1.5">
                <CheckIcon />
                Keep <strong className="text-foreground">checked</strong>
              </span>
            </Field>
            <Field label="Scopes">
              <span className="text-xs text-muted-foreground inline-flex items-center gap-1.5 flex-wrap">
                <CheckIcon />
                <code className="font-mono bg-card border border-border rounded px-1.5 py-0.5">api</code>
                <span>(full read+write — required so Telemetryc can invite members on your behalf)</span>
              </span>
            </Field>
          </dl>
        </Step>

        <Step n={3} title="Save the application">
          <p className="text-sm text-muted-foreground leading-relaxed">
            Copy the <strong className="text-foreground">Application ID</strong> and{" "}
            <strong className="text-foreground">Secret</strong>. The secret is shown once — grab it now.
          </p>
        </Step>

        <Step n={4} title="Paste them below" last>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Add the group you want to connect and we'll bounce you through GitLab to authorize.
          </p>
        </Step>
      </ol>

      {errorMsg && (
        <div className="mb-5 px-4 py-3 rounded-lg border border-destructive/40 bg-destructive/10 text-sm text-destructive">
          {decodeURIComponent(errorMsg)}
        </div>
      )}

      <form action={startGitlabOauth} className="mk-card p-5 sm:p-6 flex flex-col gap-4 rounded-lg">
        <FormField
          label="Application ID"
          hint="client_id"
          name="client_id"
          required
          minLength={10}
          placeholder="64-character hex"
        />
        <FormField
          label="Secret"
          hint="shown once when you save the app"
          name="client_secret"
          type="password"
          required
          minLength={10}
          placeholder="gloas-…"
        />
        <FormField
          label="Group"
          hint="path or numeric ID"
          name="group"
          required
          minLength={1}
          placeholder="pella-labs   ·   pella-labs/team-a   ·   12345"
        />

        <div className="flex flex-col-reverse sm:flex-row sm:items-center gap-3 mt-2">
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
            <span>Authorize on GitLab</span>
            <span aria-hidden>→</span>
          </button>
        </div>

        <div className="flex items-start gap-2 text-xs text-muted-foreground border border-border rounded-md px-3 py-2.5 bg-[color:var(--background)]/40">
          <ShieldIcon />
          <span className="leading-relaxed">
            Clicking <strong className="text-foreground">Authorize</strong> sends you to GitLab.
            Sign in as a <strong className="text-foreground">Maintainer</strong> of the group and approve the request — we never see your password.
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
      <dt className="mk-label text-muted-foreground sm:w-28 shrink-0">{label}</dt>
      <dd className="flex-1 min-w-0">{children}</dd>
    </div>
  );
}

function FormField({
  label, hint, name, type = "text", required, minLength, placeholder,
}: {
  label: string; hint?: string; name: string; type?: string;
  required?: boolean; minLength?: number; placeholder?: string;
}) {
  return (
    <label className="block">
      <div className="flex items-baseline justify-between mb-1.5">
        <span className="text-sm font-medium text-foreground">{label}</span>
        {hint && <span className="text-[11px] font-mono text-muted-foreground">{hint}</span>}
      </div>
      <input
        name={name}
        type={type}
        required={required}
        minLength={minLength}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        className="w-full font-mono text-sm bg-background/60 border border-border rounded-md px-3 py-2.5 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition placeholder:text-[color:var(--ink-faint)]"
      />
    </label>
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
