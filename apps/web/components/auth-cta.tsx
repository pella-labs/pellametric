"use client";

import Link from "next/link";
import { useSession } from "@/lib/auth-client";
import { useSignInSheet } from "@/components/sign-in-sheet";

type Variant = "nav" | "hero";

const COPY: Record<Variant, { signedIn: string; signedOut: string }> = {
  nav: { signedIn: "Dashboard", signedOut: "Sign in" },
  hero: { signedIn: "Open dashboard →", signedOut: "Sign up with GitHub" },
};

// Session-aware CTA used in the marketing nav, hero, and footer. The parent
// server component passes an `initiallySignedIn` hint from a server-side
// getSession() so SSR renders the correct label without flashing "Sign in"
// to logged-in users on hydration. Once better-auth's client session
// resolves we switch to the live value. Signed-out clicks open the shared
// SignInSheet rather than navigating away — keeps users on the marketing
// surface so the sheet inherits .telemetryc-marketing design tokens.
export default function AuthCta({
  initiallySignedIn,
  variant,
  className,
}: {
  initiallySignedIn: boolean;
  variant: Variant;
  className: string;
}) {
  const { data, isPending } = useSession();
  const signedIn = isPending ? initiallySignedIn : !!data?.user;
  const { open } = useSignInSheet();

  if (signedIn) {
    return (
      <Link href="/dashboard" className={className}>
        {COPY[variant].signedIn}
      </Link>
    );
  }
  return (
    <button type="button" onClick={open} className={className}>
      {COPY[variant].signedOut}
    </button>
  );
}
