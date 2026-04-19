import Link from "next/link";
import type { ReactNode } from "react";
import { getSessionCtx } from "@/lib/session";
import { DashboardNav } from "./_nav";
import "./dashboard.css";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const ctx = await getSessionCtx();
  const isAdmin = ctx.role === "admin";
  return (
    <div className="bematist-dashboard">
      <div className="dash-shell">
        <aside aria-label="Primary navigation" className="dash-side">
          <Link href="/home" className="dash-wordmark">
            <span className="dash-wordmark-dot" aria-hidden />
            bematist
          </Link>
          <DashboardNav isAdmin={isAdmin} />
        </aside>
        <main className="dash-main">{children}</main>
      </div>
    </div>
  );
}
