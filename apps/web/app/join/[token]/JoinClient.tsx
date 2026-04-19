"use client";

import { Button } from "@bematist/ui";
import { useState } from "react";
import { signIn } from "@/lib/auth-client";

export interface JoinClientProps {
  token: string;
}

/**
 * "Continue with GitHub" on the `/join/<token>` page. Invokes Better Auth
 * `signIn.social` with `callbackURL=/post-auth/accept-invite?token=<token>`
 * so the invitee lands back in our accept route immediately after OAuth.
 *
 * The token lives both in the current URL (that's how the page rendered)
 * and in the callbackURL — Better Auth preserves the query param through
 * the OAuth round-trip, so we never need to persist it in a cookie on
 * this side of auth.
 */
export function JoinClient({ token }: JoinClientProps) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onContinue() {
    setError(null);
    setPending(true);
    try {
      // `encodeURIComponent` guards against tokens with URL-unsafe chars,
      // though `randomBytes(32).toString('base64url')` can't produce any.
      // Full URL avoids a prod bug where Better Auth's relative callbackURL
      // resolution drops the path during the OAuth state round-trip.
      const path = `/post-auth/accept-invite?token=${encodeURIComponent(token)}`;
      const callbackURL = typeof window !== "undefined" ? `${window.location.origin}${path}` : path;
      const result = await signIn.social({ provider: "github", callbackURL });
      if (result && "error" in result && result.error) {
        setError(result.error.message ?? "Sign-in failed");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <Button
        type="button"
        size="lg"
        variant="default"
        onClick={onContinue}
        disabled={pending}
        aria-busy={pending}
        className="w-full cursor-pointer"
      >
        <GithubGlyph />
        {pending ? "Redirecting…" : "Continue with GitHub"}
      </Button>
      {error ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}

function GithubGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor" className="size-4" role="img">
      <title>GitHub</title>
      <path d="M12 .5C5.65.5.5 5.65.5 12a11.5 11.5 0 0 0 7.86 10.92c.58.1.79-.25.79-.56v-2c-3.2.7-3.87-1.37-3.87-1.37-.52-1.32-1.28-1.67-1.28-1.67-1.04-.72.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.03 1.76 2.69 1.25 3.35.96.1-.75.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.18-3.1-.12-.3-.51-1.47.11-3.07 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.78 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.6.23 2.77.11 3.07.74.81 1.18 1.84 1.18 3.1 0 4.42-2.69 5.4-5.25 5.68.41.36.78 1.06.78 2.13v3.16c0 .31.2.67.8.56A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
    </svg>
  );
}
