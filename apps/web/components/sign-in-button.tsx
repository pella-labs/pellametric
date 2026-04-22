"use client";
import { signIn } from "@/lib/auth-client";
import { useState } from "react";
import { Github, Loader2 } from "lucide-react";

export default function SignInButton({ size = "default" }: { size?: "default" | "lg" }) {
  const [loading, setLoading] = useState(false);
  const sizeClass = size === "lg" ? "px-5 py-3 text-sm" : "px-4 py-2.5 text-xs";
  return (
    <button
      disabled={loading}
      onClick={async () => {
        setLoading(true);
        await signIn.social({ provider: "github", callbackURL: "/dashboard" });
      }}
      className={`inline-flex items-center gap-2 rounded-md bg-foreground text-background font-semibold uppercase tracking-wider hover:opacity-90 disabled:opacity-60 transition ${sizeClass}`}
    >
      {loading
        ? <Loader2 className="size-4 animate-spin" />
        : <Github className="size-4" />}
      {loading ? "Redirecting…" : "Sign in with GitHub"}
    </button>
  );
}
