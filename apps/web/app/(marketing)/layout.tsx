import { headers } from "next/headers";
import Link from "next/link";
import type { ReactNode } from "react";
import AuthCta from "@/components/auth-cta";
import { SignInSheetProvider } from "@/components/sign-in-sheet";
import { auth } from "@/lib/auth";
import "./marketing.css";

const TWITTER_URL = "https://x.com/pellametric";
const GITHUB_URL = "https://github.com/pella-labs/pellametric";

export default async function MarketingLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  const initiallySignedIn = !!session?.user;
  return (
    <div className="pellametric-marketing">
      <SignInSheetProvider>
        <div className="mk-container">
          <nav className="mk-nav" aria-label="Primary">
            <Link href="/" className="mk-wordmark">
              <img
                src="/t-logo.svg"
                alt=""
                aria-hidden
                className="mk-wordmark-logo"
              />
              Telemetryc
            </Link>
            <div className="mk-nav-links">
              <a
                href={TWITTER_URL}
                className="mk-btn mk-btn-ghost mk-btn-icon"
                rel="noreferrer"
                target="_blank"
                aria-label="Follow on X"
              >
                <XMark />
                <span className="mk-btn-icon-label">Follow</span>
              </a>
              <Link href="/deck" className="mk-btn mk-btn-ghost">
                Deck
              </Link>
              <AuthCta
                initiallySignedIn={initiallySignedIn}
                variant="nav"
                className="mk-btn mk-btn-ghost"
              />
              <a
                href={GITHUB_URL}
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
              <span className="mk-footer-line">
                <img
                  src="/t-logo.svg"
                  alt=""
                  aria-hidden
                  className="mk-footer-logo"
                />
                The instrument for agentic engineering output.
              </span>
              <span className="mk-footer-sub">
                See the spend. See the work. Scale what ships. Open-source,
                self-hostable, runs against your local sessions on day one.
              </span>
            </div>
            <div className="mk-footer-links">
              <a href={TWITTER_URL} rel="noreferrer" target="_blank">
                Follow on X
              </a>
              <a href={GITHUB_URL} rel="noreferrer">
                GitHub
              </a>
              <AuthCta
                initiallySignedIn={initiallySignedIn}
                variant="nav"
                className=""
              />
            </div>
          </footer>
        </div>
      </SignInSheetProvider>
    </div>
  );
}

function XMark() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24h-6.654l-5.214-6.817-5.966 6.817H1.683l7.73-8.835L1.254 2.25h6.817l4.713 6.231 5.46-6.231zm-1.161 17.52h1.834L7.084 4.126H5.117l11.966 15.644z" />
    </svg>
  );
}
