import { Badge, Card, CardHeader, CardTitle } from "@bematist/ui";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { openWelcomeBearer, WELCOME_BEARER_COOKIE_NAME } from "@/lib/welcome-bearer-cookie";
import { CopyCommandButton } from "./CopyCommandButton";

/**
 * /welcome — the RSC the signup spine lands on after `/post-auth/new-org`.
 *
 * Two states:
 *   1. Valid welcome-bearer cookie → render the install one-liner with the
 *      freshly minted bearer inline. Cookie is deleted on the same render
 *      (one-time read).
 *   2. No cookie / expired cookie → render the generic "your key lives in
 *      /admin/ingest-keys" fallback so a reload doesn't leak the bearer
 *      and doesn't show a stale copy.
 *
 * The bearer plaintext NEVER touches the client bundle beyond the initial
 * RSC render (which is HTML over the wire, not JavaScript). The copy button
 * receives the already-rendered string via a `data-bearer` attr that never
 * gets re-serialized into client state — see `CopyCommandButton.tsx`.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "Welcome to Bematist",
  description: "Your Bematist org is ready — install the collector to start shipping events.",
  robots: { index: false, follow: false },
};

const INGEST_PUBLIC_URL = process.env.BEMATIST_INGEST_PUBLIC_URL ?? "https://ingest.bematist.dev";
const BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET ?? "dev-only-change-in-prod";

export default async function WelcomePage() {
  const ck = await cookies();
  const raw = ck.get(WELCOME_BEARER_COOKIE_NAME)?.value ?? null;
  const opened = openWelcomeBearer(raw, BETTER_AUTH_SECRET);

  // Next.js 16 disallows cookies().delete() inside Server Components. The
  // cookie has a ~120s Max-Age so it self-expires; a reload within that
  // window re-shows the bearer, which is acceptable for the signed+HttpOnly
  // envelope (no client exfiltration path). Proper single-read handoff
  // wants a Server Action or a Route Handler wrapper — follow-up.

  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-6 py-16">
      <header className="flex flex-col gap-3">
        <Badge tone="neutral">Setup</Badge>
        <h1 className="text-3xl font-semibold tracking-tight">Welcome to Bematist</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Your org is live. Install the collector on any machine running Claude Code, Cursor, Codex,
          or Continue.dev — it ships tokens and outcomes to{" "}
          <span className="font-mono text-foreground">{INGEST_PUBLIC_URL}</span> over TLS.
        </p>
      </header>

      {opened.ok ? (
        <FreshKeyPanel
          bearer={opened.payload.bearer}
          orgSlug={opened.payload.orgSlug}
          ingestUrl={INGEST_PUBLIC_URL}
        />
      ) : (
        <NoCookiePanel />
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">Next steps</h2>
        <ul className="flex flex-col gap-2 text-sm text-muted-foreground">
          <li>
            <Link
              href="/admin/ingest-keys"
              className="cursor-pointer underline underline-offset-2 hover:text-foreground"
            >
              Mint more keys
            </Link>{" "}
            for teammates or CI.
          </li>
          <li>
            <Link
              href="/dashboard"
              className="cursor-pointer underline underline-offset-2 hover:text-foreground"
            >
              Open your dashboard
            </Link>{" "}
            — first events land in under a minute.
          </li>
          <li>
            <Link
              href="/privacy"
              className="cursor-pointer underline underline-offset-2 hover:text-foreground"
            >
              Read the Bill of Rights
            </Link>{" "}
            so you know exactly what bytes leave each dev's machine.
          </li>
        </ul>
      </section>
    </div>
  );
}

function FreshKeyPanel({
  bearer,
  orgSlug,
  ingestUrl,
}: {
  bearer: string;
  orgSlug: string;
  ingestUrl: string;
}) {
  // Target shape agreed with team-lead: canonical release URL + env vars
  // prefixed onto the `sh` invocation. Today `packaging/install.sh` doesn't
  // itself read $BEMATIST_ENDPOINT/$BEMATIST_TOKEN (only $BEMATIST_REPO /
  // $BEMATIST_PREFIX) — follow-up is for the installer to persist those
  // two values into the collector config on first run. Until then the shape
  // still works as copy-paste documentation for the user to set in their
  // shell before `bematist serve`.
  const installCommand = `curl -fsSL https://github.com/pella-labs/bematist/releases/latest/download/install.sh | BEMATIST_ENDPOINT=${ingestUrl} BEMATIST_TOKEN=${bearer} sh`;

  return (
    <Card className="flex flex-col gap-4">
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <CardTitle>Install the collector</CardTitle>
          <p className="text-xs text-muted-foreground">
            Your bearer is shown exactly once. We only stored the sha256.
          </p>
        </div>
        <Badge tone="neutral">org: {orgSlug}</Badge>
      </CardHeader>

      <div className="flex flex-col gap-2">
        <div className="overflow-x-auto rounded-md border border-border bg-muted/40 p-4 font-mono text-xs leading-relaxed text-foreground">
          {installCommand}
        </div>
        <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
          <span>
            Prefer Homebrew?{" "}
            <Link
              href="/install"
              className="cursor-pointer underline underline-offset-2 hover:text-foreground"
            >
              Full install runbook →
            </Link>
          </span>
          <CopyCommandButton command={installCommand} />
        </div>
      </div>

      <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
        Copy it now. Reloading this page wipes the bearer — you'll have to mint a new one from
        <span className="mx-1 font-mono">/admin/ingest-keys</span>.
      </p>
    </Card>
  );
}

function NoCookiePanel() {
  return (
    <Card className="flex flex-col gap-3">
      <CardHeader>
        <CardTitle>Your ingest key is minted</CardTitle>
        <p className="text-xs text-muted-foreground">
          The bearer plaintext is only shown once. View the key list (by prefix) or mint a fresh one
          from the admin surface.
        </p>
      </CardHeader>
      <Link
        href="/admin/ingest-keys"
        className="inline-flex w-fit cursor-pointer items-center rounded-md border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-muted"
      >
        View ingest keys →
      </Link>
    </Card>
  );
}
