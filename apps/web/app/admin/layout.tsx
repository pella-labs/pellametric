import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { requireAdmin } from "./requireAdmin";

/**
 * M4 PR 3 — admin shell. Wraps every `/admin/*` route and enforces the
 * admin-role gate server-side before any RSC child renders.
 *
 * Non-admin visitors are redirected to `/` — NOT 404 (we don't hide the
 * existence of an admin surface from managers/engineers) and NOT 500
 * (that would look like a bug). `redirect()` throws a NEXT_REDIRECT
 * signal that Next catches at the framework layer.
 *
 * The gate is layered:
 *   1. This layout enforces role at page-navigation time.
 *   2. Every Server Action + query in `packages/api/src/queries/ingestKeys.ts`
 *      re-asserts `admin` via `assertRole()` — defense-in-depth so a forged
 *      fetch bypassing the layout still hits an `AuthError(FORBIDDEN)`.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const admission = await requireAdmin();
  if (!admission.ok) {
    redirect(admission.redirectTo);
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <aside
        aria-label="Admin navigation"
        className="flex w-56 shrink-0 flex-col border-r border-border bg-card px-4 py-6"
      >
        <Link href="/" className="mb-6 flex items-center gap-2 px-2">
          <span className="inline-block h-6 w-6 rounded-md bg-primary" aria-hidden />
          <span className="text-sm font-semibold tracking-tight">Bematist · Admin</span>
        </Link>
        <nav className="flex flex-1 flex-col gap-0.5">
          <Link
            href="/admin/ingest-keys"
            className="rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            Ingest keys
          </Link>
        </nav>
        <div className="mt-4 flex flex-col gap-0.5 border-t border-border pt-4">
          <Link
            href="/"
            className="rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            ← Back to dashboard
          </Link>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto px-8 py-6">{children}</main>
    </div>
  );
}
