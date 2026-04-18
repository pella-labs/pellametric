"use client";

import gsap from "gsap";
import { useCallback, useEffect, useRef, useState } from "react";

type Step = "signin" | "star" | "generate" | "command";

const GITHUB_REPO_URL = "https://github.com/pella-labs/bematist";

function parseRepo(url: string) {
  const match = url.match(/github\.com\/([^/]+)\/([^/]+)/);
  return match ? { owner: match[1], repo: match[2] } : null;
}

/**
 * GetStarted flow: sign in with GitHub, star the repo, generate a one-shot
 * card token, copy the npm command. Gracefully degrades to a demo mode when
 * Firebase isn't wired up yet — each step still advances so the flow is
 * fully clickable on a fresh clone.
 */
export function GetStarted() {
  const [step, setStep] = useState<Step>("signin");
  const [cardToken, setCardToken] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [copied, setCopied] = useState(false);
  const [firebaseReady, setFirebaseReady] = useState(false);
  const [authModule, setAuthModule] =
    useState<null | typeof import("firebase/auth")>(null);
  const [auth, setAuth] =
    useState<null | import("firebase/auth").Auth>(null);
  const [provider, setProvider] =
    useState<null | import("firebase/auth").GithubAuthProvider>(null);
  const starRef = useRef<HTMLDivElement>(null);

  // Dynamically load Firebase (optional; degrades to demo mode if not configured)
  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_FIREBASE_API_KEY) return;
    let cancelled = false;
    (async () => {
      const [mod, clientMod] = await Promise.all([
        import("firebase/auth"),
        import("@/lib/firebase/client"),
      ]);
      if (cancelled) return;
      setAuthModule(mod);
      setAuth(clientMod.auth);
      setProvider(clientMod.githubProvider);
      setFirebaseReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSignIn = async () => {
    if (!firebaseReady || !authModule || !auth || !provider) {
      setStep("star");
      return;
    }
    try {
      const result = await authModule.signInWithPopup(auth, provider);
      const credential = authModule.GithubAuthProvider.credentialFromResult(result);
      if (credential?.accessToken) {
        sessionStorage.setItem("github_token", credential.accessToken);
      }
      setStep("star");
    } catch (err) {
      console.error("GitHub sign-in failed", err);
    }
  };

  const playStarBurst = useCallback(() => {
    const container = starRef.current;
    if (!container) return;
    const colors = ["#fbbf24", "#f59e0b", "#d97706", "#fcd34d", "#fef3c7", "#fff"];
    for (let i = 0; i < 24; i++) {
      const particle = document.createElement("div");
      const size = Math.random() * 6 + 3;
      const star = i % 3 === 0;
      particle.style.cssText = `position:absolute;left:50%;top:50%;width:${size}px;height:${size}px;background:${colors[i % colors.length]};border-radius:${star ? "1px" : "50%"};pointer-events:none;z-index:10;${star ? "clip-path:polygon(50% 0%,61% 35%,98% 35%,68% 57%,79% 91%,50% 70%,21% 91%,32% 57%,2% 35%,39% 35%)" : ""}`;
      container.appendChild(particle);
      const angle = (i / 24) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
      const d = 60 + Math.random() * 100;
      gsap.fromTo(
        particle,
        { x: 0, y: 0, scale: 0, opacity: 1 },
        {
          x: Math.cos(angle) * d,
          y: Math.sin(angle) * d,
          scale: Math.random() * 1.5 + 0.5,
          opacity: 0,
          duration: 0.8 + Math.random() * 0.4,
          ease: "power3.out",
          onComplete: () => particle.remove(),
        },
      );
    }
    const ring = document.createElement("div");
    ring.style.cssText =
      "position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:10px;height:10px;border-radius:50%;border:2px solid #fbbf24;pointer-events:none;z-index:9";
    container.appendChild(ring);
    gsap.to(ring, {
      width: 160,
      height: 160,
      opacity: 0,
      duration: 0.6,
      ease: "power2.out",
      onComplete: () => ring.remove(),
    });
  }, []);

  const handleStar = async () => {
    setWorking(true);
    try {
      const token = sessionStorage.getItem("github_token");
      const parsed = parseRepo(GITHUB_REPO_URL);
      if (firebaseReady && token && parsed) {
        await fetch(
          `https://api.github.com/user/starred/${parsed.owner}/${parsed.repo}`,
          {
            method: "PUT",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Length": "0",
            },
          },
        );
      }
      playStarBurst();
      setTimeout(() => setStep("generate"), 900);
    } finally {
      setWorking(false);
    }
  };

  const handleGenerate = async () => {
    setWorking(true);
    try {
      if (firebaseReady && auth?.currentUser) {
        const { generateCardToken } = await import("@/lib/firebase/api");
        const { token } = await generateCardToken();
        setCardToken(token);
      } else {
        setCardToken(
          `bematist_demo-${Math.random().toString(36).slice(2, 10)}`,
        );
      }
      setStep("command");
    } finally {
      setWorking(false);
    }
  };

  const cliCommand = cardToken
    ? `npx bematist card --token ${cardToken}`
    : "";

  const handleCopy = () => {
    if (!cliCommand) return;
    navigator.clipboard.writeText(cliCommand);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="mk-getstarted">
      {!firebaseReady && (
        <div className="mk-getstarted-note">
          <span className="mk-sys">Demo mode</span>
          <p>
            Firebase isn't wired up yet, so each step advances with stub data.
            Click through to see the full flow.
          </p>
        </div>
      )}

      {step === "signin" && (
        <div className="mk-getstarted-panel">
          <h3>Sign in with GitHub</h3>
          <p>
            We use GitHub for identity only. No repo access. No cloning. The
            token we generate next is scoped to your machine.
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

      {step === "star" && (
        <div className="mk-getstarted-panel">
          <h3>Star the repo</h3>
          <p>Something magical is coming. Hit the star to unlock your card token.</p>
          <div ref={starRef} className="mk-getstarted-star-wrap">
            <button
              type="button"
              onClick={handleStar}
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
          <p>
            One-time use, one-hour expiry. Your CLI trades it for your personal
            Bematist card.
          </p>
          <button
            type="button"
            onClick={handleGenerate}
            disabled={working}
            className="mk-btn mk-btn-primary mk-getstarted-btn"
          >
            {working ? "Generating..." : "Generate token"}
          </button>
        </div>
      )}

      {step === "command" && cliCommand && (
        <div className="mk-getstarted-panel">
          <h3>Run this in your terminal</h3>
          <p>
            Bematist reads your local Claude Code / Cursor / Codex sessions.
            Only aggregated numbers leave your machine. Never prompt text,
            never code.
          </p>
          <div className="mk-getstarted-cmd">
            <pre>{cliCommand}</pre>
            <button
              type="button"
              onClick={handleCopy}
              className="mk-btn mk-btn-ghost"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="mk-getstarted-finefoot">
            Token expires in 1 hour. Your card will live at /card/&lt;you&gt;
            after submit.
          </p>
        </div>
      )}
    </div>
  );
}

function GithubMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
    </svg>
  );
}

function StarIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.562.562 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.562.562 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
    </svg>
  );
}
