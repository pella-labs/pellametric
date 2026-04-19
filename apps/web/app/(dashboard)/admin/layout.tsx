import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { requireAdmin } from "./requireAdmin";

/**
 * Admin gate only — the dashboard shell (sidebar, header, typography) is
 * inherited from the parent `(dashboard)` layout. Non-admins are redirected
 * to `/` rather than 404'd; the query/mutation layer re-asserts role via
 * `assertRole()` for defense-in-depth.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const admission = await requireAdmin();
  if (!admission.ok) {
    redirect(admission.redirectTo);
  }
  return <>{children}</>;
}
