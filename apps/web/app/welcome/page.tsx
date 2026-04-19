import { Badge, Card, CardHeader, CardTitle } from "@bematist/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { CopyCommandButton } from "./CopyCommandButton";

/**
 * /welcome — the landing page after first sign-in (via invite or new-org).
 *
 * Simplified as of M5 §L8: this page no longer mints or displays an inline
 * bearer. Credentials flow via `bematist login` (OAuth Device Authorization
 * Grant — RFC 8628) which opens a browser and calls the `/auth/device`
 * approval surface. This page's job is now just "here's how to install the
 * collector and log in." See dev-docs/m5-installer-plan.md §Scope for the
 * end-to-end flow.
 *
 * The `welcome-bearer-cookie.ts` lib is kept for any existing callers that
 * may still mint one-shot tokens during onboarding; its display path has
 * moved to /admin/ingest-keys for explicit minting.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "Welcome to Bematist",
  description: "Install the Bematist collector and authorize your first device.",
  robots: { index: false, follow: false },
};

const INGEST_PUBLIC_URL = process.env.BEMATIST_INGEST_PUBLIC_URL ?? "https://ingest.bematist.dev";

export default async function WelcomePage() {
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

      <InstallCard />

      <section className="flex flex-col gap-3 rounded-lg border border-border bg-card p-5">
        <h2 className="text-base font-semibold">What `bematist login` does</h2>
        <ul className="flex flex-col gap-2 text-sm text-muted-foreground">
          <li>
            Opens <code className="font-mono text-foreground">/auth/device</code> in your browser
            with a short code. You confirm the code matches your terminal and click Approve.
          </li>
          <li>
            Mints a per-device ingest key tied to this org. You can revoke it any time from{" "}
            <Link
              href="/admin/ingest-keys"
              className="cursor-pointer underline underline-offset-2 hover:text-foreground"
            >
              /admin/ingest-keys
            </Link>
            .
          </li>
          <li>
            Writes credentials to{" "}
            <code className="font-mono text-foreground">~/.bematist/config.env</code> (mode 0600)
            and starts the background daemon.
          </li>
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">Next steps</h2>
        <ul className="flex flex-col gap-2 text-sm text-muted-foreground">
          <li>
            <Link
              href="/dashboard"
              className="cursor-pointer underline underline-offset-2 hover:text-foreground"
            >
              Open your dashboard
            </Link>{" "}
            — first events land within a minute of `bematist login`.
          </li>
          <li>
            <Link
              href="/admin/ingest-keys"
              className="cursor-pointer underline underline-offset-2 hover:text-foreground"
            >
              Mint a headless key
            </Link>{" "}
            for CI / bots that can't run `bematist login`.
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

// bematist.dev/install.sh 302s to the GH release `latest/download/install.sh`
// so this resolves to the newest signed script + binary. `bematist login`
// auto-starts the daemon as of v0.1.7 — no separate `bematist start` needed.
const INSTALL_LINE = "curl -fsSL https://bematist.dev/install.sh | sh && bematist login";

function InstallCard() {
  return (
    <Card className="flex flex-col gap-4">
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <CardTitle>macOS / Linux</CardTitle>
          <p className="text-xs text-muted-foreground">
            Paste this into your terminal. Your browser opens to confirm.
          </p>
        </div>
      </CardHeader>
      <div className="flex flex-col gap-2">
        <div className="overflow-x-auto rounded-md border border-border bg-muted/40 p-4 font-mono text-xs leading-relaxed text-foreground">
          {INSTALL_LINE}
        </div>
        <div className="flex items-center justify-end">
          <CopyCommandButton command={INSTALL_LINE} />
        </div>
      </div>
    </Card>
  );
}
