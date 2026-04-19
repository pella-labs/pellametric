import { getInvitePreview } from "@bematist/api";
import type { GetInvitePreviewResult } from "@bematist/api/schemas/invite";
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { getAuth } from "@/lib/auth";
import { getDbClients } from "@/lib/db";
import { JoinClient } from "./JoinClient";

/**
 * Public landing for an invite link. Rendered server-side without any auth
 * gate — the invitee may arrive via their personal email client or a chat
 * link, having never visited the dashboard before.
 *
 * What we show, by lifecycle:
 *   - `active`    → org name + role + "Continue with GitHub" CTA
 *   - `revoked`   → friendly "this invite was revoked" with a link to
 *                   `/auth/sign-in` in case they meant to sign in normally
 *   - `expired`   → "this invite expired on <date>; ask your admin for a new one"
 *   - `accepted`  → "already accepted — sign in to continue" CTA
 *   - `not_found` → generic "we don't recognize this link"
 *
 * Cache: `force-dynamic` + no-index. The token is in the URL, so OG/link
 * previewers could otherwise scrape + store a preview; `noindex,nofollow`
 * plus the opaque-by-design token length keeps the blast radius narrow.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "Join on Bematist",
  robots: { index: false, follow: false },
};

export default async function JoinInvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const db = getDbClients();
  const preview = await getInvitePreview(db.pg, { token });

  // If the visitor is already signed in, they don't need another OAuth
  // round-trip — we can send them straight to the accept route. Better
  // Auth's signIn.social doesn't reliably honor callbackURL when the
  // session already exists, so avoid relying on that path.
  const hs = await headers();
  const session = await getAuth().api.getSession({ headers: hs });
  const alreadySignedIn = Boolean(session?.user);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen max-w-3xl flex-col px-6 py-10">
        <header className="flex items-center justify-between">
          <Link
            href="/home"
            className="flex cursor-pointer items-center gap-2 text-sm font-semibold tracking-tight"
          >
            <span aria-hidden className="inline-block h-6 w-6 rounded-md bg-primary" />
            bematist
          </Link>
          <Link
            href="/privacy"
            className="cursor-pointer text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            Bill of Rights
          </Link>
        </header>

        <main className="flex flex-1 flex-col items-center justify-center gap-8">
          {preview.ok ? (
            <ActiveInvite preview={preview} token={token} alreadySignedIn={alreadySignedIn} />
          ) : (
            <InactiveInvite error={preview.error} />
          )}
        </main>

        <footer className="pt-10 text-center text-[11px] text-muted-foreground">
          Bematist observes agents, not editors. What you see in{" "}
          <Link
            href="/privacy"
            className="cursor-pointer underline underline-offset-2 hover:text-foreground"
          >
            the Bill of Rights
          </Link>{" "}
          is what leaves your machine — nothing more.
        </footer>
      </div>
    </div>
  );
}

function ActiveInvite({
  preview,
  token,
  alreadySignedIn,
}: {
  preview: Extract<GetInvitePreviewResult, { ok: true }>;
  token: string;
  alreadySignedIn: boolean;
}) {
  return (
    <div className="flex w-full max-w-md flex-col gap-6 rounded-xl border border-border bg-card p-8 shadow-sm">
      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          You're invited
        </span>
        <h1 className="text-2xl font-semibold tracking-tight">
          Join <span className="text-primary">{preview.org_name}</span> on Bematist
        </h1>
        <p className="text-sm text-muted-foreground">
          {alreadySignedIn ? (
            <>
              You'll land as{" "}
              <strong className="font-medium text-foreground">
                {preview.role === "admin" ? "admin" : "engineer"}
              </strong>{" "}
              in {preview.org_name}.
            </>
          ) : (
            <>
              You'll sign in with GitHub and land as{" "}
              <strong className="font-medium text-foreground">
                {preview.role === "admin" ? "admin" : "engineer"}
              </strong>{" "}
              in {preview.org_name}. We only read your GitHub email and handle — no repo access.
            </>
          )}
        </p>
      </div>

      {alreadySignedIn ? (
        <Link
          href={`/post-auth/accept-invite?token=${encodeURIComponent(token)}`}
          className="inline-flex w-full cursor-pointer items-center justify-center rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Accept invite →
        </Link>
      ) : (
        <JoinClient token={token} />
      )}

      <p className="text-[11px] text-muted-foreground">
        Invite expires{" "}
        <time dateTime={preview.expires_at} className="font-mono text-foreground">
          {new Date(preview.expires_at).toLocaleDateString(undefined, {
            year: "numeric",
            month: "short",
            day: "numeric",
          })}
        </time>
        .
      </p>
    </div>
  );
}

function InactiveInvite({
  error,
}: {
  error: "not_found" | "revoked" | "expired" | "already_accepted";
}) {
  const copy = messageFor(error);
  return (
    <div className="flex w-full max-w-md flex-col gap-6 rounded-xl border border-border bg-card p-8 shadow-sm">
      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-destructive">
          {copy.tag}
        </span>
        <h1 className="text-2xl font-semibold tracking-tight">{copy.title}</h1>
        <p className="text-sm text-muted-foreground">{copy.body}</p>
      </div>

      <div className="flex flex-col gap-2">
        <Link
          href="/auth/sign-in"
          className="inline-flex w-full cursor-pointer items-center justify-center rounded-md border border-border bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-muted"
        >
          Sign in to Bematist →
        </Link>
        <Link
          href="/home"
          className="cursor-pointer text-center text-xs text-muted-foreground hover:text-foreground"
        >
          Or learn more about Bematist
        </Link>
      </div>
    </div>
  );
}

function messageFor(error: "not_found" | "revoked" | "expired" | "already_accepted"): {
  tag: string;
  title: string;
  body: string;
} {
  switch (error) {
    case "revoked":
      return {
        tag: "Revoked",
        title: "This invite was revoked",
        body: "The admin who sent it has since pulled it. Ask them for a fresh link if you still need access.",
      };
    case "expired":
      return {
        tag: "Expired",
        title: "This invite has expired",
        body: "Invites are good for up to 14 days. Ask your admin to send a new one.",
      };
    case "already_accepted":
      return {
        tag: "Already used",
        title: "This invite was already accepted",
        body: "Invites are one-time. Sign in with the GitHub account that accepted it, or ask your admin for a new link.",
      };
    // biome-ignore lint/complexity/noUselessSwitchCase: explicit case makes the "not_found → default" mapping obvious at a glance.
    case "not_found":
    default:
      return {
        tag: "Unknown",
        title: "We don't recognize this link",
        body: "Double-check the URL you were given, or ask your admin to send a new invite.",
      };
  }
}
