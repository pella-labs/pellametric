import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth";
import { getDbClients } from "@/lib/db";
import { DeviceApproveClient } from "./DeviceApproveClient";

/**
 * /auth/device — the page `bematist login` opens in the user's browser to
 * complete the OAuth Device Authorization Grant (RFC 8628 §3.3). Flow:
 *
 *   1. CLI opens ?code=<user_code> in the browser.
 *   2. If not signed in, redirect to /auth/sign-in with a callbackURL
 *      that preserves ?code= so we land back here post-OAuth.
 *   3. If signed in: look up the code, show verification state, render
 *      Approve + Deny buttons.
 *   4. On Approve: server action flips approved_at + attaches the user's
 *      org_id. CLI's next poll mints a bearer and exits.
 *
 * Cache: force-dynamic + no-index. The user_code is in the URL; we never
 * want it preview-scraped or cached by a proxy.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "Authorize CLI — Bematist",
  robots: { index: false, follow: false },
};

interface DeviceCodeInfo {
  user_code: string;
  user_agent: string | null;
  expires_at: Date;
  approved_at: Date | null;
  denied_at: Date | null;
  claimed_at: Date | null;
}

async function loadCodeInfo(userCode: string): Promise<DeviceCodeInfo | null> {
  const { pg } = getDbClients();
  const rows = await pg.query<DeviceCodeInfo>(
    `SELECT user_code, user_agent, expires_at, approved_at, denied_at, claimed_at
     FROM device_codes
     WHERE user_code = $1
     LIMIT 1`,
    [userCode],
  );
  return rows[0] ?? null;
}

export default async function DeviceAuthPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const { code } = await searchParams;

  // No ?code= → prompt for manual entry (user hit the root URL from a
  // different device or copy-pasted without the query string).
  if (!code) {
    return <ManualEntryFallback />;
  }

  const hs = await headers();
  const session = await getAuth().api.getSession({ headers: hs });
  if (!session?.user) {
    // Preserve the code through Better Auth's OAuth round-trip.
    const back = `/auth/device?code=${encodeURIComponent(code)}`;
    redirect(`/auth/sign-in?callbackURL=${encodeURIComponent(back)}`);
  }

  const info = await loadCodeInfo(code);
  if (!info) return <CodeStateCard state="not_found" userCode={code} />;

  const expired = info.expires_at.getTime() < Date.now();
  if (expired) return <CodeStateCard state="expired" userCode={code} />;
  if (info.denied_at) return <CodeStateCard state="denied" userCode={code} />;
  if (info.claimed_at) return <CodeStateCard state="claimed" userCode={code} />;
  if (info.approved_at) return <CodeStateCard state="approved" userCode={code} />;

  return (
    <PageShell>
      <DeviceApproveClient
        userCode={info.user_code}
        deviceLabel={info.user_agent}
        userEmail={session.user.email ?? null}
      />
    </PageShell>
  );
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen max-w-3xl flex-col px-6 py-10">
        <header className="flex items-center justify-between">
          <a
            href="/home"
            className="flex cursor-pointer items-center gap-2 text-sm font-semibold tracking-tight"
          >
            <span aria-hidden className="inline-block h-6 w-6 rounded-md bg-primary" />
            bematist
          </a>
          <a
            href="/privacy"
            className="cursor-pointer text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            Bill of Rights
          </a>
        </header>
        <main className="flex flex-1 flex-col items-center justify-center gap-8">{children}</main>
      </div>
    </div>
  );
}

function ManualEntryFallback() {
  return (
    <PageShell>
      <div className="flex w-full max-w-md flex-col gap-6 rounded-xl border border-border bg-card p-8 shadow-sm">
        <h1 className="text-2xl font-semibold tracking-tight">Authorize a CLI session</h1>
        <p className="text-sm text-muted-foreground">
          Open this page by running <code className="font-mono text-foreground">bematist login</code>{" "}
          in your terminal. The CLI prints a URL with the code pre-filled.
        </p>
        <p className="text-xs text-muted-foreground">
          If you know the user code, you can append it to this URL:{" "}
          <code className="font-mono text-foreground">?code=ABCD1234</code>.
        </p>
      </div>
    </PageShell>
  );
}

type CodeState = "not_found" | "expired" | "denied" | "claimed" | "approved";

function CodeStateCard({ state, userCode }: { state: CodeState; userCode: string }) {
  const copy = copyFor(state);
  return (
    <PageShell>
      <div className="flex w-full max-w-md flex-col gap-6 rounded-xl border border-border bg-card p-8 shadow-sm">
        <div className="flex flex-col gap-2">
          <span className={`text-xs font-medium uppercase tracking-wide ${copy.tagColor}`}>
            {copy.tag}
          </span>
          <h1 className="text-2xl font-semibold tracking-tight">{copy.title}</h1>
          <p className="text-sm text-muted-foreground">{copy.body}</p>
          <p className="mt-2 text-xs text-muted-foreground">
            Code: <code className="font-mono text-foreground">{userCode}</code>
          </p>
        </div>
      </div>
    </PageShell>
  );
}

function copyFor(state: CodeState): {
  tag: string;
  tagColor: string;
  title: string;
  body: string;
} {
  switch (state) {
    case "expired":
      return {
        tag: "Expired",
        tagColor: "text-destructive",
        title: "This code expired",
        body: "Device codes last 10 minutes. Run `bematist login` in your terminal to start a new session.",
      };
    case "denied":
      return {
        tag: "Denied",
        tagColor: "text-destructive",
        title: "This code was denied",
        body: "The authorization request was declined. If you didn't click Deny, someone else may have been approving a different session.",
      };
    case "claimed":
      return {
        tag: "Claimed",
        tagColor: "text-muted-foreground",
        title: "This CLI session is already authorized",
        body: "Your terminal already received the credentials. You can close this tab.",
      };
    case "approved":
      return {
        tag: "Approved",
        tagColor: "text-primary",
        title: "Waiting for your terminal to pick up credentials",
        body: "Your CLI should finish automatically within a few seconds. You can close this tab.",
      };
    case "not_found":
      return {
        tag: "Unknown",
        tagColor: "text-muted-foreground",
        title: "We don't recognize that code",
        body: "Double-check the code your terminal printed, or run `bematist login` again.",
      };
  }
}
