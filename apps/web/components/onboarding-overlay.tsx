"use client";
import { useEffect, useRef, useState } from "react";

type Step = "install" | "invite" | "collector";

const COPY: Record<Step, { title: string; body: string }> = {
  install: {
    title: "Install Pellametric on GitHub",
    body: "One click — lets us send GitHub invites and pull team-wide PR data on your behalf. The org owner has to do this once.",
  },
  invite: {
    title: "Invite your first teammate",
    body: "Type their GitHub login. They'll get an email from GitHub to join the org and another from pellametric to start tracking.",
  },
  collector: {
    title: "Set up your data collector",
    body: "A small binary watches your local Claude Code / Codex sessions and uploads them. Your dashboard fills in once it's running.",
  },
};

export default function OnboardingOverlay({
  orgId, activeStep,
}: {
  orgId: string;
  activeStep: Step | null;
}) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [hidden, setHidden] = useState(true);
  const targetRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const dismissed = window.localStorage.getItem(`onboarding_hidden_${orgId}`);
    setHidden(dismissed === "1");
  }, [orgId]);

  useEffect(() => {
    if (hidden || !activeStep) return;
    const measure = () => {
      const el = document.querySelector<HTMLElement>(`[data-onboarding="${activeStep}"]`);
      if (!el) { setRect(null); targetRef.current = null; return; }
      targetRef.current = el;
      setRect(el.getBoundingClientRect());
    };
    measure();
    const onScrollOrResize = () => requestAnimationFrame(measure);
    window.addEventListener("resize", onScrollOrResize);
    window.addEventListener("scroll", onScrollOrResize, true);
    // Re-measure once after layout settles (e.g. fonts, images loaded).
    const t1 = window.setTimeout(measure, 150);
    const t2 = window.setTimeout(measure, 600);
    return () => {
      window.removeEventListener("resize", onScrollOrResize);
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [activeStep, hidden]);

  if (hidden || !activeStep) return null;
  if (!rect) return null;

  const PAD = 6;
  const r = {
    top: rect.top - PAD,
    left: rect.left - PAD,
    width: rect.width + PAD * 2,
    height: rect.height + PAD * 2,
  };
  const right = r.left + r.width;
  const bottom = r.top + r.height;

  function dismiss() {
    window.localStorage.setItem(`onboarding_hidden_${orgId}`, "1");
    setHidden(true);
  }

  // Tooltip placement: prefer below the target; flip above if not enough room.
  const VIEWPORT_H = typeof window !== "undefined" ? window.innerHeight : 800;
  const VIEWPORT_W = typeof window !== "undefined" ? window.innerWidth : 1200;
  const TIP_W = 320;
  const TIP_OFFSET = 14;
  const tipBelow = bottom + TIP_OFFSET + 160 < VIEWPORT_H;
  const tipTop = tipBelow ? bottom + TIP_OFFSET : Math.max(8, r.top - TIP_OFFSET - 160);
  const tipLeft = Math.min(Math.max(8, r.left), VIEWPORT_W - TIP_W - 8);

  const copy = COPY[activeStep];

  return (
    <>
      {/* Four blurred "frame" divs cover everything except the target rect.
          Clicks on these absorb (so user can't accidentally click other parts of the page).
          The target hole is empty, so clicks fall through to the actual button. */}
      <div className="fixed inset-x-0 top-0 backdrop-blur-md bg-black/45 z-40" style={{ height: Math.max(0, r.top) }} />
      <div className="fixed inset-x-0 bottom-0 backdrop-blur-md bg-black/45 z-40" style={{ top: bottom }} />
      <div className="fixed left-0 backdrop-blur-md bg-black/45 z-40" style={{ top: r.top, width: Math.max(0, r.left), height: r.height }} />
      <div className="fixed right-0 backdrop-blur-md bg-black/45 z-40" style={{ top: r.top, left: right, height: r.height }} />

      {/* Pulsing accent ring around the target — purely decorative, doesn't block clicks. */}
      <div
        className="fixed pointer-events-none rounded-md z-40"
        style={{
          top: r.top, left: r.left, width: r.width, height: r.height,
          boxShadow: "0 0 0 2px #6e8a6f, 0 0 0 8px rgba(110, 138, 111, 0.30)",
          animation: "pellametric-pulse 1.6s ease-in-out infinite",
        }}
      />

      {/* Tooltip card */}
      <div
        className="fixed z-50 bg-card border border-border rounded-md p-4 shadow-2xl"
        style={{ top: tipTop, left: tipLeft, width: TIP_W }}
      >
        <div className="text-sm font-semibold leading-snug">{copy.title}</div>
        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{copy.body}</p>
        <div className="flex items-center justify-between mt-3">
          <button
            onClick={dismiss}
            className="text-xs h-7 px-3 rounded-md border border-accent text-accent hover:bg-accent hover:text-accent-foreground transition leading-none"
          >
            Hide for now
          </button>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {activeStep === "install" ? "Step 1 / 3" : activeStep === "invite" ? "Step 2 / 3" : "Step 3 / 3"}
          </span>
        </div>
      </div>

    </>
  );
}
