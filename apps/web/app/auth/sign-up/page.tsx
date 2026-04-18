import type { Metadata } from "next";
import { redirect } from "next/navigation";

/**
 * Sign-up is the same flow as sign-in (GitHub OAuth lazily creates an
 * account on first callback). Redirect rather than render a separate
 * page so there's one canonical URL — `/auth/sign-in` — and links from
 * docs / marketing land on the same affordance regardless of phrasing.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sign up",
  robots: { index: false, follow: false },
};

export default function SignUpPage() {
  redirect("/auth/sign-in");
}
