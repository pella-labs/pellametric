"use client";
import { signIn } from "@/lib/auth-client";
import { useState } from "react";

export default function SignInButton() {
  const [loading, setLoading] = useState(false);
  return (
    <button
      disabled={loading}
      onClick={async () => {
        setLoading(true);
        await signIn.social({ provider: "github", callbackURL: "/dashboard" });
      }}
      className="mk-label bg-accent text-accent-foreground px-4 py-2.5 hover:opacity-90 disabled:opacity-60 transition"
    >
      {loading ? "Redirecting…" : "Sign in with GitHub"}
    </button>
  );
}
