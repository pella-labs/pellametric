import { Inter, JetBrains_Mono, Space_Mono } from "next/font/google";
import Link from "next/link";
import type { ReactNode } from "react";
import "./marketing.css";

const mkSans = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mk-sans",
});

const mkMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-mk-mono",
});

const mkSys = Space_Mono({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-mk-sys",
});

const NAV = [
  { href: "/home#adapters", label: "Adapters" },
  { href: "/home#privacy", label: "Privacy" },
  { href: "/home#install", label: "Install" },
  { href: "/privacy", label: "Bill of Rights" },
];

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className={`bematist-marketing ${mkSans.variable} ${mkMono.variable} ${mkSys.variable}`}>
      <div className="mk-container">
        <nav className="mk-nav" aria-label="Primary">
          <Link href="/home" className="mk-wordmark">
            bematist
          </Link>
          <div className="mk-nav-links">
            {NAV.map((item) => (
              <Link key={item.href} href={item.href} className="mk-nav-link">
                {item.label}
              </Link>
            ))}
            <Link href="/" className="mk-btn mk-btn-ghost">
              Sign in
            </Link>
            <a
              href="https://github.com/pella-labs/bematist"
              className="mk-btn mk-btn-primary"
              rel="noreferrer"
            >
              GitHub
            </a>
          </div>
        </nav>
        {children}
        <footer className="mk-footer">
          <div className="mk-footer-copy">
            <span className="mk-footer-line">The dashboard for AI-assisted engineering.</span>
            <span className="mk-footer-sub">
              The card gets you in. The dashboard keeps you — spend by project, wins by workflow,
              and patterns worth copying across your team.
            </span>
          </div>
          <div>
            <Link href="/privacy">Bill of Rights</Link>
            <a href="https://github.com/pella-labs/bematist" rel="noreferrer">
              GitHub
            </a>
            <Link href="/">Dashboard</Link>
          </div>
        </footer>
      </div>
    </div>
  );
}
