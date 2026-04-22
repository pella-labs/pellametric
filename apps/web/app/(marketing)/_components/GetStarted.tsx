"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { signIn, useSession } from "@/lib/auth-client";

type Flow = "oauth" | "manual";
type Step = "entry" | "signin" | "star" | "username" | "generate" | "command";

const GITHUB_REPO_URL = "https://github.com/pella-labs/pellametric";

/**
 * Marketing entry flow. Two identity paths both converge on
 * `POST /api/card/token` → copy-paste CLI command:
 *   1. OAuth — better-auth redirect to GitHub, callback lands at
 *      /card?getstarted=1, auto-advances to the star step.
 *   2. Star-gate — user stars on github.com themselves, enters username,
 *      /api/card/token-by-star checks the public stargazers list.
 */
export function GetStarted() {
  const session = useSession() as { data?: { user?: { id: string } } | null };

  const [step, setStep] = useState<Step>("entry");
  const [flow, setFlow] = useState<Flow>("oauth");
  const [cardToken, setCardToken] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [copied, setCopied] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [manualUsername, setManualUsername] = useState("");
  const starRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (session.data?.user && step === "entry") {
      const params = new URLSearchParams(window.location.search);
      if (params.get("getstarted") === "1") {
        setFlow("oauth");
        setStep("star");
      }
    }
  }, [session.data, step]);

  const handlePickOAuth = () => {
    setFlow("oauth");
    setStep("signin");
  };

  const handlePickManual = () => {
    setFlow("manual");
    window.open(GITHUB_REPO_URL, "_blank", "noopener,noreferrer");
    setStep("username");
  };

  const handleSignIn = async () => {
    await signIn.social({ provider: "github", callbackURL: "/card?getstarted=1" });
  };

  const playStarBurst = useCallback(() => {
    const container = starRef.current;
    if (!container) return;
    const colors = ["#fbbf24", "#f59e0b", "#d97706", "#fcd34d", "#fef3c7", "#fff"];
    for (let i = 0; i < 18; i++) {
      const p = document.createElement("div");
      const size = Math.random() * 6 + 3;
      const ang = (i / 18) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
      const d = 60 + Math.random() * 80;
      p.style.cssText = `position:absolute;left:50%;top:50%;width:${size}px;height:${size}px;background:${colors[i % colors.length]};border-radius:50%;pointer-events:none;z-index:10;opacity:1;transform:translate(-50%,-50%);transition:transform 800ms cubic-bezier(.22,1,.36,1), opacity 900ms ease-out;`;
      container.appendChild(p);
      requestAnimationFrame(() => {
        p.style.transform = `translate(calc(-50% + ${Math.cos(ang) * d}px), calc(-50% + ${Math.sin(ang) * d}px)) scale(${0.5 + Math.random()})`;
        p.style.opacity = "0";
      });
      setTimeout(() => p.remove(), 950);
    }
  }, []);

  const handleStarOAuth = async () => {
    setWorking(true);
    try {
      await fetch("/api/card/star-repo", { method: "POST", credentials: "include" });
      playStarBurst();
      setTimeout(() => setStep("generate"), 900);
    } finally {
      setWorking(false);
    }
  };

  const handleVerifyByUsername = async () => {
    setVerifyError(null);
    const username = manualUsername.trim();
    if (!/^[a-zA-Z0-9][a-zA-Z0-9-]{0,38}$/.test(username)) {
      setVerifyError("Enter a valid GitHub username.");
      return;
    }
    setWorking(true);
    try {
      const res = await fetch("/api/card/token-by-star", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username }),
      });
      const text = await res.text();
      const data = text ? (JSON.parse(text) as { token?: string; error?: string }) : {};
      if (res.ok && data.token) {
        setCardToken(data.token);
        playStarBurst();
        setTimeout(() => setStep("command"), 900);
      } else if (data.error === "not_starred") {
        setVerifyError(
          "We don't see a star from that account yet. Double-check your GitHub username, star the repo, then try again.",
        );
      } else {
        setVerifyError(data.error ?? `Could not verify (HTTP ${res.status}).`);
      }
    } catch (e) {
      setVerifyError(e instanceof Error ? `Error: ${e.message}` : "Network error. Try again.");
    } finally {
      setWorking(false);
    }
  };

  const handleGenerate = async () => {
    setWorking(true);
    setVerifyError(null);
    try {
      const res = await fetch("/api/card/token", { method: "POST", credentials: "include" });
      const text = await res.text();
      const data = text ? (JSON.parse(text) as { token?: string; error?: string }) : {};
      if (res.ok && data.token) {
        setCardToken(data.token);
        setStep("command");
      } else {
        setVerifyError(data.error ?? `Could not generate token (HTTP ${res.status}). Try signing in again.`);
      }
    } catch (e) {
      setVerifyError(e instanceof Error ? e.message : "Network error. Try again.");
    } finally {
      setWorking(false);
    }
  };

  const cliCommand = useMemo(() => {
    if (!cardToken) return "";
    return `npx pellametric ${cardToken}`;
  }, [cardToken]);

  const handleCopy = () => {
    if (!cliCommand) return;
    navigator.clipboard.writeText(cliCommand);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="mk-getstarted">
      {step === "entry" && (
        <div className="mk-getstarted-entry">
          <button
            type="button"
            onClick={handlePickOAuth}
            className="mk-getstarted-entry-card mk-getstarted-entry-primary"
          >
            <GithubMark />
            <div>
              <div className="mk-getstarted-entry-title">Sign in with GitHub</div>
              <div className="mk-getstarted-entry-sub">One-click star, one-click token. Recommended.</div>
            </div>
            <div className="mk-getstarted-entry-chevron" aria-hidden>→</div>
          </button>
          <div className="mk-getstarted-entry-divider"><span>or</span></div>
          <button
            type="button"
            onClick={handlePickManual}
            className="mk-getstarted-entry-card mk-getstarted-entry-alt"
          >
            <StarIcon />
            <div>
              <div className="mk-getstarted-entry-title">Star manually, no sign-in</div>
              <div className="mk-getstarted-entry-sub">
                Star on GitHub yourself, then enter your username. We verify the star is public.
              </div>
            </div>
          </button>
        </div>
      )}

      {step === "signin" && (
        <div className="mk-getstarted-panel">
          <h3>Sign in with GitHub</h3>
          <p>
            We use GitHub for identity and to star the repo for you. The card token we generate
            next is scoped to your machine.
          </p>
          <button
            type="button"
            onClick={handleSignIn}
            className="mk-btn mk-btn-primary mk-getstarted-btn"
          >
            <GithubMark />
            Continue with GitHub
          </button>
        </div>
      )}

      {step === "username" && (
        <div className="mk-getstarted-panel">
          <h3>Enter your GitHub username</h3>
          <p>
            We opened{" "}
            <a href={GITHUB_REPO_URL} target="_blank" rel="noreferrer" className="mk-getstarted-link">
              pella-labs/pellametric
            </a>{" "}
            in a new tab. Star it there, then drop your username below — we'll check the public
            stargazers list and hand you your card token. No sign-in needed.
          </p>
          <div className="mk-getstarted-username">
            <input
              type="text"
              inputMode="text"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              placeholder="your-github-username"
              value={manualUsername}
              onChange={(e) => setManualUsername(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !working) handleVerifyByUsername(); }}
              disabled={working}
              className="mk-getstarted-username-input"
            />
            <button
              type="button"
              onClick={handleVerifyByUsername}
              disabled={working || manualUsername.trim().length === 0}
              className="mk-btn mk-btn-primary mk-getstarted-btn"
            >
              <StarIcon />
              {working ? "Verifying..." : "Verify star"}
            </button>
          </div>
          {verifyError && <p className="mk-getstarted-error">{verifyError}</p>}
        </div>
      )}

      {step === "star" && flow === "oauth" && (
        <div className="mk-getstarted-panel">
          <h3>Star the repo</h3>
          <p>One click. We'll send the star, then hand you the token.</p>
          <div ref={starRef} className="mk-getstarted-star-wrap">
            <button
              type="button"
              onClick={handleStarOAuth}
              disabled={working}
              className="mk-btn mk-btn-primary mk-getstarted-btn"
            >
              <StarIcon />
              {working ? "Starring..." : "Star on GitHub"}
            </button>
          </div>
        </div>
      )}

      {step === "generate" && (
        <div className="mk-getstarted-panel">
          <h3>Generate your card token</h3>
          <p>One-time use, one-hour expiry. Your CLI trades it for your personal Pella Metrics card.</p>
          <button
            type="button"
            onClick={handleGenerate}
            disabled={working}
            className="mk-btn mk-btn-primary mk-getstarted-btn"
          >
            {working ? "Generating..." : "Generate token"}
          </button>
          {verifyError && <p className="mk-getstarted-error">{verifyError}</p>}
        </div>
      )}

      {step === "command" && cliCommand && (
        <div className="mk-getstarted-panel">
          <h3>Run this in your terminal</h3>
          <p>
            Pella Metrics reads your local Claude Code and Codex sessions. Only aggregated numbers
            leave your machine. Never prompt text, never code.
          </p>
          <div className="mk-getstarted-cmd">
            <pre>{cliCommand}</pre>
            <button type="button" onClick={handleCopy} className="mk-btn mk-btn-ghost">
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="mk-getstarted-finefoot">
            Token expires in 1 hour. Your card will live at /card/&lt;you&gt; after submit.
          </p>
        </div>
      )}
    </div>
  );
}

function GithubMark() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
    </svg>
  );
}

function StarIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.562.562 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.562.562 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
    </svg>
  );
}
