"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/", label: "Summary", match: "exact" as const },
  { href: "/teams", label: "Teams" },
  { href: "/sessions", label: "Sessions" },
  { href: "/outcomes", label: "Outcomes" },
  { href: "/clusters", label: "Clusters" },
  { href: "/insights", label: "Insights" },
  { href: "/me/digest", label: "My digest" },
];

function isActive(pathname: string, href: string, match?: "exact"): boolean {
  if (match === "exact") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function DashboardNav() {
  const pathname = usePathname() ?? "/";
  return (
    <nav className="dash-nav">
      {NAV.map((item) => {
        const active = isActive(pathname, item.href, item.match);
        return (
          <Link
            key={item.href}
            href={item.href}
            className="dash-nav-link"
            aria-current={active ? "page" : undefined}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
