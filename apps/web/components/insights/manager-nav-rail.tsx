// F3.19 — Manager nav rail. Linear/Swarmia-density: 240px column, dense link
// list, mk-table-cell type. Highlights the active route via usePathname.

"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { slug: "", label: "Overview", icon: "▤" },
  { slug: "insights", label: "Insights", icon: "▲" },
  { slug: "prs", label: "Pull requests", icon: "◼" },
  { slug: "devs", label: "Devs", icon: "◈" },
  { slug: "waste", label: "Waste", icon: "◆" },
  { slug: "intent", label: "Intent", icon: "◊" },
  { slug: "benchmark", label: "Benchmark", icon: "☴" },
];

const SETTINGS = [
  { slug: "members", label: "Members" },
  { slug: "policy", label: "Policy" },
  { slug: "invite", label: "Invite" },
];

export function ManagerNavRail({
  base,
  orgName,
  role,
  meBase,
}: {
  base: string;
  orgName: string;
  role: "manager" | "dev";
  meBase: string;
}): React.ReactElement {
  const pathname = usePathname() ?? "";
  return (
    <aside className="hidden md:flex md:flex-col w-60 shrink-0 border-r border-(--border) p-4 space-y-6">
      <div>
        <p className="mk-eyebrow">Pellametric</p>
        <p className="mk-heading text-(--foreground) text-base">{orgName}</p>
        <p className="mk-table-cell text-(--muted-foreground)">
          {role === "manager" ? "Manager view" : "Dev view"}
        </p>
      </div>
      <nav className="space-y-1">
        {ITEMS.map(i => {
          const href = i.slug ? `${base}/${i.slug}` : base;
          const isActive =
            i.slug === ""
              ? pathname === base
              : pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={i.slug || "overview"}
              href={href}
              className={`flex items-center gap-2 px-2 py-1.5 mk-table-cell rounded-[var(--radius)] ${
                isActive
                  ? "bg-(--secondary) text-(--foreground)"
                  : "text-(--muted-foreground) hover:text-(--foreground) hover:bg-(--secondary)"
              }`}
            >
              <span className="text-(--accent)">{i.icon}</span>
              <span className="flex-1">{i.label}</span>
            </Link>
          );
        })}
      </nav>
      <div className="space-y-1 pt-4 border-t border-(--border)">
        <p className="mk-label mb-2">Settings</p>
        {SETTINGS.map(s => {
          const href = `${base}/${s.slug}`;
          const isActive = pathname === href;
          return (
            <Link
              key={s.slug}
              href={href}
              className={`block px-2 py-1.5 mk-table-cell rounded-[var(--radius)] ${
                isActive
                  ? "bg-(--secondary) text-(--foreground)"
                  : "text-(--muted-foreground) hover:text-(--foreground) hover:bg-(--secondary)"
              }`}
            >
              {s.label}
            </Link>
          );
        })}
      </div>
      <div className="mt-auto pt-4 border-t border-(--border)">
        <Link
          href={meBase}
          className="block mk-table-cell text-(--accent) hover:underline"
        >
          → switch to my view
        </Link>
      </div>
    </aside>
  );
}
