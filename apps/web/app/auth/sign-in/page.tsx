import { isComplianceEnabled } from "@bematist/api";
import type { Metadata } from "next";
import { SignInClient } from "./SignInClient";

/**
 * M4 PR 1 — minimal real sign-in page.
 *
 * GitHub OAuth is the ONLY flow at this milestone; we intentionally do not
 * ship an email/password form. The single `<SignInClient>` client component
 * calls `authClient.signIn.social({ provider: "github" })` and Better Auth
 * handles the 302 redirect + callback.
 *
 * Dynamic: never statically cache — we want the server to re-evaluate
 * auth state on every request so a logged-in user hitting `/auth/sign-in`
 * bounces to `/` via middleware instead of rendering the form.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to Bematist",
  robots: { index: false, follow: false },
};

export default function SignInPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <SignInClient showBillOfRightsLink={isComplianceEnabled()} />
    </div>
  );
}
