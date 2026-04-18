"use client";

import { Button, Card, CardHeader, CardTitle } from "@bematist/ui";
import { useState } from "react";
import { signIn } from "@/lib/auth-client";

/**
 * Client-side sign-in surface. One affordance: "Continue with GitHub".
 *
 * On click → `authClient.signIn.social({ provider: "github" })` redirects
 * the browser to GitHub's OAuth consent page. Better Auth handles the
 * callback at `/api/auth/callback/github` and sets the signed session
 * cookie. After callback, we navigate to `/` (the dashboard home).
 *
 * Error handling: surface the Better Auth error message inline so the dev
 * sees "OAuth not configured" style failures when `GITHUB_CLIENT_ID` is
 * unset. Reset on the next click.
 */
export function SignInClient() {
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  async function handleGithub() {
    setError(null);
    setIsPending(true);
    try {
      const result = await signIn.social({
        provider: "github",
        callbackURL: "/",
      });
      // Better Auth returns `{ error }` on failure; a successful flow
      // triggers a browser redirect and we never see a response.
      if (result && "error" in result && result.error) {
        setError(result.error.message ?? "Sign-in failed");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
    } finally {
      setIsPending(false);
    }
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="text-base text-foreground">Sign in to Bematist</CardTitle>
        <p className="text-xs text-muted-foreground">
          We only read your GitHub email + handle. No repo access.
        </p>
      </CardHeader>

      <div className="mt-4 flex flex-col gap-3">
        <Button
          type="button"
          size="lg"
          variant="default"
          onClick={handleGithub}
          disabled={isPending}
          aria-busy={isPending}
          className="cursor-pointer"
        >
          <GithubGlyph />
          {isPending ? "Redirecting…" : "Continue with GitHub"}
        </Button>

        {error ? (
          <p
            role="alert"
            className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
          >
            {error}
          </p>
        ) : null}

        <p className="mt-2 text-center text-[11px] text-muted-foreground">
          By continuing you agree to the{" "}
          <a href="/privacy" className="underline underline-offset-2 hover:text-foreground">
            Bill of Rights
          </a>
          .
        </p>
      </div>
    </Card>
  );
}

/**
 * Inline GitHub glyph (Octicon-derived). Bundled as an SVG so we don't
 * need an icon library just for one button.
 */
function GithubGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor" className="size-4" role="img">
      <title>GitHub</title>
      <path d="M12 .5C5.65.5.5 5.65.5 12a11.5 11.5 0 0 0 7.86 10.92c.58.1.79-.25.79-.56v-2c-3.2.7-3.87-1.37-3.87-1.37-.52-1.32-1.28-1.67-1.28-1.67-1.04-.72.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.03 1.76 2.69 1.25 3.35.96.1-.75.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.18-3.1-.12-.3-.51-1.47.11-3.07 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.78 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.6.23 2.77.11 3.07.74.81 1.18 1.84 1.18 3.1 0 4.42-2.69 5.4-5.25 5.68.41.36.78 1.06.78 2.13v3.16c0 .31.2.67.8.56A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
    </svg>
  );
}
