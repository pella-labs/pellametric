import Link from "next/link";
import type { ReactNode } from "react";

const NAV = [
  { href: "/", label: "Summary" },
  { href: "/teams", label: "Teams" },
  { href: "/sessions", label: "Sessions" },
  { href: "/clusters", label: "Clusters" },
  { href: "/insights", label: "Insights" },
  { href: "/me", label: "Me" },
  { href: "/me/digest", label: "Digest" },
];

const META_LINKS = [{ href: "/privacy", label: "Bill of Rights" }];

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden">
      <aside
        aria-label="Primary navigation"
        className="flex w-56 shrink-0 flex-col border-r border-border bg-card px-4 py-6"
      >
        <Link href="/" className="mb-6 flex items-center gap-2 px-2">
          <span className="inline-block h-6 w-6 rounded-md bg-primary" aria-hidden />
          <span className="text-sm font-semibold tracking-tight">Bematist</span>
        </Link>
        <nav className="flex flex-1 flex-col gap-0.5">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="mt-4 flex flex-col gap-0.5 border-t border-border pt-4">
          {META_LINKS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              {item.label}
            </Link>
          ))}
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto px-8 py-6">{children}</main>
    </div>
  );
}
