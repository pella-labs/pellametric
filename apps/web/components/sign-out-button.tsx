"use client";
import { signOut } from "@/lib/auth-client";

export default function SignOutButton() {
  return (
    <button
      onClick={() => signOut({ fetchOptions: { onSuccess: () => { window.location.href = "/"; } } })}
      className="mk-label border border-border px-3 py-2 hover:border-[color:var(--border-hover)] transition"
    >
      Sign out
    </button>
  );
}
