import Link from "next/link";
import type { ReactNode } from "react";
import "./marketing.css";

const TWITTER_URL = "https://x.com/bematist_dev";
const GITHUB_URL = "https://github.com/pella-labs/bematist";

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="bematist-marketing">
      <div className="mk-container">
        <nav className="mk-nav" aria-label="Primary">
          <Link href="/home" className="mk-wordmark">
            bematist
          </Link>
          <div className="mk-nav-links">
            <Link href="/install" className="mk-nav-link">
              Install
            </Link>
            <a
              href={TWITTER_URL}
              className="mk-btn mk-btn-ghost mk-btn-icon"
              rel="noreferrer"
              target="_blank"
              aria-label="Follow Bematist on X"
            >
              <XMark />
              <span className="mk-btn-icon-label">Follow</span>
            </a>
            <Link href="/" className="mk-btn mk-btn-ghost">
              Sign in
            </Link>
            <a href={GITHUB_URL} className="mk-btn mk-btn-primary" rel="noreferrer">
              GitHub
            </a>
          </div>
        </nav>
        {children}
        <footer className="mk-footer">
          <div className="mk-footer-copy">
            <span className="mk-footer-line">The instrument for AI-assisted engineering.</span>
            <span className="mk-footer-sub">
              Spend by project, wins by workflow, and the patterns worth copying across your team.
              The data was always yours — we just made it legible.
            </span>
          </div>
          <div>
            <Link href="/install">Install</Link>
            <a href={TWITTER_URL} rel="noreferrer" target="_blank">
              Follow on X
            </a>
            <a href={GITHUB_URL} rel="noreferrer">
              GitHub
            </a>
            <Link href="/">Dashboard</Link>
          </div>
        </footer>
      </div>
    </div>
  );
}

function XMark() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24h-6.654l-5.214-6.817-5.966 6.817H1.683l7.73-8.835L1.254 2.25h6.817l4.713 6.231 5.46-6.231zm-1.161 17.52h1.834L7.084 4.126H5.117l11.966 15.644z" />
    </svg>
  );
}
