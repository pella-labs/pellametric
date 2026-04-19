import Link from "next/link";
import type { ReactNode } from "react";
import "./dashboard.css";

const NAV = [
  { href: "/", label: "Summary" },
  { href: "/teams", label: "Teams" },
  { href: "/sessions", label: "Sessions" },
  { href: "/outcomes", label: "Outcomes" },
  { href: "/clusters", label: "Clusters" },
  { href: "/insights", label: "Insights" },
];

const META_NAV = [
  { href: "/me/digest", label: "My digest" },
  { href: "/privacy", label: "Bill of Rights" },
];

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="bematist-dashboard">
      <div className="dash-shell">
        <div className="dash-chrome" aria-hidden>
          <span className="dash-chrome-dot" style={{ background: "#ff5f57" }} />
          <span className="dash-chrome-dot" style={{ background: "#febc2e" }} />
          <span className="dash-chrome-dot" style={{ background: "#28c840" }} />
          <span className="dash-chrome-url">bematist.yourteam.internal</span>
        </div>
        <aside aria-label="Primary navigation" className="dash-side">
          <Link href="/home" className="dash-wordmark">
            <span className="dash-wordmark-dot" aria-hidden />
            bematist
          </Link>
          <nav className="dash-nav">
            {NAV.map((item) => (
              <Link key={item.href} href={item.href} className="dash-nav-link">
                {item.label}
              </Link>
            ))}
            <div className="dash-nav-meta">
              {META_NAV.map((item) => (
                <Link key={item.href} href={item.href} className="dash-nav-link">
                  {item.label}
                </Link>
              ))}
            </div>
          </nav>
        </aside>
        <main className="dash-main">{children}</main>
      </div>
    </div>
  );
}
