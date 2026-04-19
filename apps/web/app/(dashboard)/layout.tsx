import Link from "next/link";
import type { ReactNode } from "react";
import { DashboardNav } from "./_nav";
import "./dashboard.css";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="bematist-dashboard">
      <div className="dash-shell">
        <aside aria-label="Primary navigation" className="dash-side">
          <Link href="/home" className="dash-wordmark">
            <span className="dash-wordmark-dot" aria-hidden />
            bematist
          </Link>
          <DashboardNav />
        </aside>
        <main className="dash-main">{children}</main>
      </div>
    </div>
  );
}
