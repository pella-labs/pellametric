"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { signIn } from "@/lib/auth-client";

type SheetContext = {
  open: () => void;
  close: () => void;
};

const Ctx = createContext<SheetContext | null>(null);

export function useSignInSheet() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useSignInSheet must be used inside <SignInSheetProvider>");
  return ctx;
}

export function SignInSheetProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  return (
    <Ctx.Provider value={{ open, close }}>
      {children}
      <SignInSheet isOpen={isOpen} onClose={close} />
    </Ctx.Provider>
  );
}

function SignInSheet({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [loading, setLoading] = useState<null | "github" | "gitlab">(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    buttonRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSignIn = async (provider: "github" | "gitlab") => {
    if (loading) return;
    setLoading(provider);
    try {
      await signIn.social({ provider, callbackURL: "/dashboard" });
    } catch {
      setLoading(null);
    }
  };

  return (
    <div
      className="mk-sheet-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="mk-sheet-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div ref={panelRef} className="mk-sheet-panel">
        <span className="mk-sheet-glow" aria-hidden />
        <button
          type="button"
          className="mk-sheet-close"
          aria-label="Close"
          onClick={onClose}
        >
          <CloseIcon />
        </button>
        <div className="mk-sheet-brand">
          <span className="mk-sheet-brand-mark" aria-hidden>
            <img src="/primary-logo.svg" alt="" />
          </span>
          <span className="mk-sheet-brand-text mk-sys">telemetryc</span>
        </div>
        <h2 id="mk-sheet-title" className="mk-sheet-title">
          Sign in
        </h2>
        <p className="mk-sheet-body">
          Use GitHub or GitLab — we only read what's needed to scope data to your orgs. No passwords, no email lists.
        </p>
        <div className="mk-sheet-actions">
          <button
            ref={buttonRef}
            type="button"
            onClick={() => handleSignIn("github")}
            disabled={loading !== null}
            className="mk-btn mk-btn-primary mk-sheet-cta"
          >
            {loading === "github" ? <SpinnerIcon /> : <GithubIcon />}
            {loading === "github" ? "Redirecting…" : "Continue with GitHub"}
          </button>
          <div className="mk-sheet-divider" aria-hidden>
            <span>or</span>
          </div>
          <button
            type="button"
            onClick={() => handleSignIn("gitlab")}
            disabled={loading !== null}
            className="mk-btn mk-sheet-cta mk-sheet-cta-secondary mk-sheet-cta-gitlab"
          >
            {loading === "gitlab" ? <SpinnerIcon /> : <GitlabIcon />}
            {loading === "gitlab" ? "Redirecting…" : "Continue with GitLab"}
          </button>
        </div>
        <div className="mk-sheet-scope">
          <ShieldIcon />
          <span>
            Read-only access · <code>read:org</code> <code>repo</code> on GitHub · <code>read_user</code> <code>read_api</code> on GitLab · revocable any time in provider settings.
          </span>
        </div>
      </div>
    </div>
  );
}

function ShieldIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 1.5l5.5 2v4.2c0 3.1-2.3 5.9-5.5 6.8-3.2-.9-5.5-3.7-5.5-6.8V3.5L8 1.5z" />
      <path d="M5.8 8.2l1.6 1.6 3-3" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

function GithubIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 .5a11.5 11.5 0 0 0-3.64 22.42c.58.11.79-.25.79-.56v-2c-3.2.7-3.88-1.38-3.88-1.38-.52-1.33-1.28-1.68-1.28-1.68-1.04-.72.08-.7.08-.7 1.15.08 1.76 1.19 1.76 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.47.11-3.06 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.78 0c2.21-1.49 3.18-1.18 3.18-1.18.63 1.59.23 2.77.11 3.06.74.81 1.19 1.84 1.19 3.1 0 4.42-2.69 5.4-5.26 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.2.68.8.56A11.5 11.5 0 0 0 12 .5z" />
    </svg>
  );
}

function GitlabIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M23.6 9.6L23.57 9.5l-3.27-8.5a.85.85 0 0 0-.81-.55.85.85 0 0 0-.81.6l-2.21 6.76H7.54L5.33 1.04A.85.85 0 0 0 4.52.45a.85.85 0 0 0-.81.55L.43 9.5l-.03.1a6.05 6.05 0 0 0 2.01 6.99l.01.01.03.02 4.96 3.72 2.46 1.86 1.5 1.13a1 1 0 0 0 1.21 0l1.5-1.13 2.46-1.86 5-3.74.01-.01A6.05 6.05 0 0 0 23.6 9.6z" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true" style={{ animation: "mk-sheet-spin 0.7s linear infinite" }}>
      <path d="M12 3 A 9 9 0 0 1 21 12" />
    </svg>
  );
}
