/** biome-ignore-all lint/a11y/noSvgWithoutTitle: decorative marketing icons; adjacent text carries meaning */
/** biome-ignore-all lint/a11y/useButtonType: decorative marketing buttons; interactive semantics via onClick handlers */

"use client";

import { toPng } from "html-to-image";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

// Client-side card fetch via the public /api/card/:id endpoint. Response
// shape is locked in `apps/web/app/api/card/[id]/route.ts`.
async function getCard(cardId: string) {
  const res = await fetch(`/api/card/${cardId}`);
  if (!res.ok) throw new Error("Card not found");
  return res.json();
}

import {
  type CardData,
  formatTokens,
  getAchievements,
  getCacheSaved,
  getCodexPersonality,
  getLevel,
  getPersonality,
  getTier,
  getTotalTokens,
  mapPersonality,
  normalizeHours,
} from "./card-utils";
import "./card.css";
import "./holo.css";
import "./card-pellametric.css";
import {
  ChevronLeft,
  ChevronRight,
  CopyIcon,
  DownloadIcon,
  ShareIcon,
} from "./icons";
import { Slide, TOTAL_PAGES } from "./slides";

function cleanProjectName(name: string): string {
  const parts = name.split("-").filter(Boolean);
  return parts[parts.length - 1] || name;
}

export function CardPage({
  demoData,
  compact = false,
  autoAdvanceMs,
}: {
  demoData?: CardData;
  compact?: boolean;
  /**
   * When set, automatically advances through the 8 card pages on a
   * timer with wrap-around. Used by the deck's final slide so the
   * audience sees every card face without keyboard input. Kicks in
   * only after phase >= 2 (card has entered) and skips ticks while
   * a page transition is in flight.
   */
  autoAdvanceMs?: number;
} = {}) {
  const params = useParams<{ id?: string }>();
  const id = params?.id;
  const [data, setData] = useState<CardData | null>(demoData ?? null);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(0);
  const [exitingPage] = useState<{
    page: number;
    direction: "left" | "right";
  } | null>(null);
  const [enteringFrom, setEnteringFrom] = useState<"left" | "right" | null>(
    null,
  );
  const [statView, setStatView] = useState<"combined" | "claude" | "codex">(
    "combined",
  );
  const [cardTheme] = useState<"cream" | "dark">("dark");
  const [phase, setPhase] = useState(0);
  const [showShare, setShowShare] = useState(false);
  const [, setShowHint] = useState(false);
  const [nudging, setNudging] = useState(false);
  const nudgeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flipperRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<{
    tiltX: number;
    tiltY: number;
    mx: number;
    my: number;
    hover: number;
    scale: number;
  }>({
    tiltX: 0,
    tiltY: 0,
    mx: 0,
    my: 0,
    hover: 0,
    scale: 1,
  });

  useEffect(() => {
    if (demoData) return;
    if (!id) return;
    getCard(id)
      .then(setData)
      .catch(() => setError("Card not found"));
  }, [id, demoData]);

  // Card-relative pointer: drives both tilt (mx/my) and holo vars (pointer-x/y, background-x/y).
  // `data` is listed as a dependency so the effect re-runs after the async
  // fetch on /card/:id mounts the flipper. See the deps array below for the
  // full reasoning.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `data` is a re-run trigger, not a consumed value.
  useEffect(() => {
    const flipper = flipperRef.current;
    if (!flipper) return;
    const onMove = (e: PointerEvent) => {
      // Ignore touch/pen — those devices can fire pointermove without a
      // matching pointerleave, which leaves `is-hovering` stuck on after a
      // swipe and paints the card in the hot red/pink hover palette.
      if (e.pointerType !== "mouse") return;
      const rect = flipper.getBoundingClientRect();
      const px = Math.max(
        0,
        Math.min(100, ((e.clientX - rect.left) / rect.width) * 100),
      );
      const py = Math.max(
        0,
        Math.min(100, ((e.clientY - rect.top) / rect.height) * 100),
      );
      // target .card-holo directly; setting on .card-flipper loses to .card-holo's declared rule
      const holo = flipper.querySelector<HTMLElement>(".card-holo");
      const el = holo ?? flipper;
      el.style.setProperty("--pointer-x", `${px}%`);
      el.style.setProperty("--pointer-y", `${py}%`);
      el.style.setProperty("--background-x", `${37 + (px / 100) * 26}%`);
      el.style.setProperty("--background-y", `${33 + (py / 100) * 34}%`);
      // card-relative -1..1 for tilt
      animRef.current.mx = px / 50 - 1;
      animRef.current.my = py / 50 - 1;
      animRef.current.hover = 1;
    };
    // Drive glow via JS class so it works on Windows/touch devices that don't reliably fire :hover
    const onEnter = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      flipper.classList.add("is-hovering");
    };
    const onLeave = () => {
      animRef.current.mx = 0;
      animRef.current.my = 0;
      animRef.current.hover = 0;
      flipper.classList.remove("is-hovering");
    };
    // Any touch anywhere on the doc clears the stuck hover, defending
    // against the "swipe then card stays red" case.
    const clearHover = () => {
      flipper.classList.remove("is-hovering");
      animRef.current.hover = 0;
    };
    flipper.addEventListener("pointerenter", onEnter);
    flipper.addEventListener("pointermove", onMove);
    flipper.addEventListener("pointerleave", onLeave);
    flipper.addEventListener("pointercancel", onLeave);
    document.addEventListener("touchstart", clearHover, { passive: true });
    return () => {
      flipper.removeEventListener("pointerenter", onEnter);
      flipper.removeEventListener("pointermove", onMove);
      flipper.removeEventListener("pointerleave", onLeave);
      flipper.removeEventListener("pointercancel", onLeave);
      document.removeEventListener("touchstart", clearHover);
    };
    // Depend on `data` so listeners re-attach after the async fetch on
    // /card/:id mounts the flipper — the first pass runs with data=null,
    // `if (!data) return null` skips rendering, and flipperRef.current
    // is null. Without this, the holo hover never wires up on shared cards.
  }, [data]);

  useEffect(() => {
    if (!data) return;
    const start = performance.now();
    const T = { cardStart: 0, cardLand: 1400, content: 1500 };
    let localPhase = 0;
    let animId: number;

    function eOutBack(t: number) {
      const c = 2.5;
      return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2;
    }
    function ease(t: number) {
      return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
    }

    function animate() {
      animId = requestAnimationFrame(animate);
      const elapsed = performance.now() - start;
      const flipper = flipperRef.current;
      if (!flipper) return;
      const a = animRef.current;

      if (elapsed >= T.cardStart && elapsed <= T.cardLand + 300) {
        const dur = T.cardLand - T.cardStart;
        const p = Math.min((elapsed - T.cardStart) / dur, 1);
        const eLand = eOutBack(p);
        const eRot = ease(p);
        const tz = -600 * (1 - eLand);
        const ry = eRot * 360;
        const rz = 15 * (1 - eRot);
        const sc = 0.2 + eLand * 0.8;
        flipper.style.transform = `translateZ(${tz}px) rotateY(${ry}deg) rotateZ(${rz}deg) scale(${sc})`;
        flipper.style.opacity = String(Math.min(p * 4, 1));
      }

      if (elapsed > T.cardLand + 400 && localPhase < 2) {
        localPhase = 2;
        setPhase(2);
        flipper.style.opacity = "1";
      }

      if (localPhase >= 2) {
        // tilt now driven by CARD-relative pointer; ±14° range like simey's preview
        const targetX = a.hover ? a.my * -14 : 0;
        const targetY = a.hover ? a.mx * 14 : 0;
        const targetScale = a.hover ? 1.05 : 1;
        a.tiltX += (targetX - a.tiltX) * 0.4;
        a.tiltY += (targetY - a.tiltY) * 0.4;
        a.scale += (targetScale - a.scale) * 0.18;
        flipper.style.transform = `rotateX(${a.tiltX}deg) rotateY(${a.tiltY}deg) scale(${a.scale})`;
        const mxPct = `${((a.mx + 1) / 2) * 100}%`;
        const myPct = `${((a.my + 1) / 2) * 100}%`;
        flipper.style.setProperty("--mx", mxPct);
        flipper.style.setProperty("--my", myPct);
      }

      if (elapsed >= T.content && localPhase < 3) {
        localPhase = 3;
        setPhase(3);
        setShowShare(true);
        setShowHint(true);
      }
    }
    // Schedule via RAF rather than running synchronously so that if React
    // StrictMode mounts + unmounts + re-mounts in dev, cleanup can cancel
    // the pending frame before it ever paints — only one animation plays.
    animId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animId);
  }, [data]);

  // Navigate: next card slides in from the right
  const handleNextPage = useCallback(() => {
    if (
      phase < 2 ||
      exitingPage ||
      enteringFrom ||
      currentPage >= TOTAL_PAGES - 1
    )
      return;
    setCurrentPage((p) => p + 1);
    setEnteringFrom("right");
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setEnteringFrom(null);
      });
    });
  }, [phase, exitingPage, enteringFrom, currentPage]);

  const handlePrevPage = useCallback(() => {
    if (phase < 2 || exitingPage || enteringFrom || currentPage <= 0) return;
    // Slide previous card in from the left on top
    setCurrentPage((p) => p - 1);
    setEnteringFrom("left");
    // Let the CSS transition play, then clear
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setEnteringFrom(null);
      });
    });
  }, [phase, exitingPage, enteringFrom, currentPage]);

  // Auto-advance (deck mode): cycle through all 8 pages on a timer with
  // wrap-around. Gated on `phase >= 2` so the intro animation plays first.
  // `animLockRef` mirrors the in-flight transition state so the interval
  // doesn't have to re-subscribe on every rAF tick.
  const animLockRef = useRef(false);
  useEffect(() => {
    animLockRef.current = Boolean(exitingPage || enteringFrom);
  }, [exitingPage, enteringFrom]);

  useEffect(() => {
    if (!autoAdvanceMs || phase < 2) return;
    const id = setInterval(() => {
      if (animLockRef.current) return;
      setCurrentPage((p) => (p + 1) % TOTAL_PAGES);
      setEnteringFrom("right");
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setEnteringFrom(null);
        });
      });
    }, autoAdvanceMs);
    return () => clearInterval(id);
  }, [autoAdvanceMs, phase]);

  // Nudge hint: wiggle the top card after idle
  const resetNudgeTimer = useCallback(() => {
    if (nudgeTimerRef.current) clearTimeout(nudgeTimerRef.current);
    setNudging(false);
    nudgeTimerRef.current = setTimeout(function runNudge() {
      setNudging(true);
      setTimeout(() => setNudging(false), 800);
      nudgeTimerRef.current = setTimeout(runNudge, 5000);
    }, 3000);
  }, []);

  useEffect(() => {
    if (phase >= 3) resetNudgeTimer();
    return () => {
      if (nudgeTimerRef.current) clearTimeout(nudgeTimerRef.current);
    };
  }, [phase, resetNudgeTimer]);

  // Reset nudge timer on page change
  useEffect(() => {
    if (phase >= 3) resetNudgeTimer();
  }, [phase, resetNudgeTimer]);

  // Keyboard support
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") handleNextPage();
      else if (e.key === "ArrowLeft") handlePrevPage();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleNextPage, handlePrevPage]);

  // Touch swipe support
  const touchRef = useRef<{ startX: number; startY: number } | null>(null);
  useEffect(() => {
    const el = flipperRef.current?.parentElement;
    if (!el) return;
    const onStart = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      touchRef.current = { startX: t.clientX, startY: t.clientY };
    };
    const onEnd = (e: TouchEvent) => {
      if (!touchRef.current) return;
      const t = e.changedTouches[0];
      if (!t) return;
      const dx = t.clientX - touchRef.current.startX;
      const dy = t.clientY - touchRef.current.startY;
      touchRef.current = null;
      if (Math.abs(dx) < 40 || Math.abs(dy) > Math.abs(dx)) return;
      if (dx < 0) handleNextPage();
      else handlePrevPage();
    };
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchend", onEnd, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchend", onEnd);
    };
  }, [handleNextPage, handlePrevPage]);

  const shareOnTwitter = () => {
    // Hook → product namecheck → CTA. @pellametric threads the tweet
    // under the profile; the URL carries the sharer's card so viewers
    // see the stats in the card preview, then click through to mint
    // their own.
    const text = encodeURIComponent(
      `Where did my tokens go? @pellametric knows. Grab your card →`,
    );
    const url = encodeURIComponent(window.location.href);
    window.open(
      `https://x.com/intent/tweet?text=${text}&url=${url}`,
      "_blank",
      "width=550,height=420",
    );
  };

  const shareOnLinkedIn = () => {
    // LinkedIn's share-offsite endpoint only honors `url`; it scrapes the
    // page's OG tags for title/description/image, which /card already sets.
    const url = encodeURIComponent(window.location.href);
    window.open(
      `https://www.linkedin.com/sharing/share-offsite/?url=${url}`,
      "_blank",
      "width=550,height=600",
    );
  };

  const [toast, setToast] = useState<string | null>(null);
  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  // Shared: capture the visible card face as a blob
  const captureCard = async (): Promise<Blob | null> => {
    const flipper = flipperRef.current;
    if (!flipper) return null;
    const face =
      (flipper.querySelector(".card-stack-item.top") as HTMLElement) ||
      (flipper.querySelector(".card-front") as HTMLElement);
    if (!face) return null;

    const origFlipper = flipper.style.transform;
    const origFace = face.style.transform;
    flipper.style.transform = "none";
    face.style.transform = "none";

    try {
      const radius = parseFloat(getComputedStyle(face).borderRadius) || 24;
      const dataUrl = await toPng(face, {
        pixelRatio: 2,
        style: {
          borderRadius: `${radius}px`,
          overflow: "hidden",
          background: "transparent",
        },
      });
      flipper.style.transform = origFlipper;
      face.style.transform = origFace;
      const res = await fetch(dataUrl);
      return await res.blob();
    } catch {
      flipper.style.transform = origFlipper;
      face.style.transform = origFace;
      return null;
    }
  };

  const [downloading, setDownloading] = useState(false);
  const handleDownload = async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      const blob = await captureCard();
      if (!blob) {
        showToast("Failed to capture card");
        return;
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.download = `pellametric-card-${currentPage + 1}.png`;
      link.href = url;
      link.click();
      URL.revokeObjectURL(url);
      showToast("Card saved!");
    } catch {
      showToast("Download failed");
    } finally {
      setDownloading(false);
    }
  };

  const copyImage = async () => {
    try {
      const blob = await captureCard();
      if (!blob) {
        showToast("Failed to capture card");
        return;
      }
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": blob }),
      ]);
      showToast("Image copied to clipboard!");
    } catch {
      // Fallback: copy URL if image clipboard not supported
      try {
        await navigator.clipboard.writeText(window.location.href);
        showToast("Link copied!");
      } catch {
        showToast("Copy failed");
      }
    }
  };

  if (error) {
    return (
      <div
        style={{
          minHeight: "60vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "rgba(237,232,222,0.6)",
          fontFamily: "var(--font-mk-mono, monospace)",
          fontSize: 13,
          letterSpacing: "0.04em",
        }}
      >
        {error}
      </div>
    );
  }
  // Pre-data: render nothing. Keeps the container transparent so the
  // marketing shell shows through, and avoids a visible loading spinner
  // flashing before the flip animation takes over.
  if (!data) return null;

  const s = data.stats;
  const hl = s.highlights;
  const userName =
    data.user?.displayName ||
    (data.user?.githubUsername ? `@${data.user.githubUsername}` : "Developer");
  const totalTokens = getTotalTokens(s);
  const tier = getTier(
    statView === "claude"
      ? s.claude.sessions
      : statView === "codex"
        ? s.codex.sessions
        : s.combined.totalSessions,
  );
  const lvl = getLevel(
    statView === "claude"
      ? s.claude.sessions
      : statView === "codex"
        ? s.codex.sessions
        : s.combined.totalSessions,
  );
  const personalityCombined = hl
    ? mapPersonality(hl.personality)
    : getPersonality(s.claude.hourDistribution);
  const personalityClaude = getPersonality(s.claude.hourDistribution);
  const personalityCodex = getCodexPersonality(s);
  const personality =
    statView === "codex"
      ? personalityCodex
      : statView === "claude"
        ? personalityClaude
        : personalityCombined;
  const hourBars = normalizeHours(s.claude.hourDistribution);
  const topTools = s.claude.topTools.slice(0, 5);

  const cacheSaved = getCacheSaved(s);
  const achievements = getAchievements(s, statView);

  const activeDays = s.combined.totalActiveDays ?? s.claude.activeDays;
  const allModels = Object.entries({ ...s.claude.models, ...s.codex.models })
    .map(([name, d]) => ({ name, cost: d.cost, sessions: d.sessions }))
    .filter((m) => m.cost > 0 && m.name !== "unknown")
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 5);

  // Merge projects
  const projectMap = new Map<
    string,
    { sessions: number; cost: number; source: string }
  >();
  for (const p of s.claude.projects ?? []) {
    const n = cleanProjectName(p.name);
    projectMap.set(n, { sessions: p.sessions, cost: p.cost, source: "claude" });
  }
  for (const p of s.codex?.projects ?? []) {
    const n = cleanProjectName(p.name);
    const ex = projectMap.get(n);
    if (ex) {
      ex.sessions += p.sessions;
      ex.cost += p.cost;
      ex.source = "both";
    } else
      projectMap.set(n, {
        sessions: p.sessions,
        cost: p.cost,
        source: "codex",
      });
  }
  const topProjects = Array.from(projectMap.entries())
    .map(([name, d]) => ({ name, ...d }))
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 8);
  const mostExpensive = hl?.mostExpensiveSession ?? null;
  const activityCategories = (hl?.activityCategories ?? []).slice(0, 5);
  const actCatColors = ["#6e8a6f", "#8fb078", "#b07b3e", "#d4a771", "#52715a"];

  // Daily distribution for 30-day heatmap
  const dailyDist = s.combined.dailyDistribution ?? [];

  // View-specific stats for Claude/Codex toggle
  const viewTokens =
    statView === "claude"
      ? s.claude.inputTokens + s.claude.outputTokens
      : statView === "codex"
        ? s.codex.inputTokens + s.codex.outputTokens
        : totalTokens;
  const viewCost =
    statView === "claude"
      ? s.claude.cost
      : statView === "codex"
        ? s.codex.cost
        : s.combined.totalCost;
  const viewCacheSaved =
    statView === "codex"
      ? s.codex.cachedInputTokens
        ? `${formatTokens(s.codex.cachedInputTokens)} cached`
        : "$0"
      : cacheSaved;
  const viewActiveDays =
    statView === "claude"
      ? s.claude.activeDays
      : statView === "codex"
        ? (s.codex.activeDays ?? 0)
        : activeDays;
  const viewStreak =
    statView === "codex"
      ? (s.codex.activeDays ?? 0)
      : (hl?.longestStreak ?? s.claude.activeDays);

  // View-specific models
  const viewModels =
    statView === "combined"
      ? allModels
      : Object.entries(statView === "claude" ? s.claude.models : s.codex.models)
          .map(([name, d]) => ({ name, cost: d.cost, sessions: d.sessions }))
          .filter((m) => m.cost > 0 && m.name !== "unknown")
          .sort((a, b) => b.cost - a.cost)
          .slice(0, 5);

  // View-specific projects
  const viewProjects =
    statView === "combined"
      ? topProjects
      : (statView === "claude"
          ? (s.claude.projects ?? [])
          : (s.codex.projects ?? [])
        )
          .map((p) => ({
            name: cleanProjectName(p.name),
            sessions: p.sessions,
            cost: p.cost,
            source: statView,
          }))
          .sort((a, b) => b.cost - a.cost)
          .slice(0, 8);

  const show = phase >= 3;

  // Card face background
  const CardBg = () => (
    <>
      <div className="card-bg" />
      <div className="aurora-blob ab1" />
      <div className="aurora-blob ab2" />
      <div className="aurora-blob ab3" />
      <div className="card__fire" />
      <div className="card__cyan" />
      <div className="sheen" />
    </>
  );

  return (
    <div
      className="card-root"
      style={{
        fontFamily: "'Inter', sans-serif",
        background: "transparent",
        overflow: "hidden",
        width: "100%",
        WebkitFontSmoothing: "antialiased",
        position: "relative",
      }}
      data-compact={compact ? "true" : undefined}
    >
      {/* Top bar: source toggle + theme toggle */}
      <div className={`global-toggle ${showShare ? "show" : ""}`}>
        {s.codex.sessions > 0 && (
          <div className="source-toggle">
            <button
              className={`stog ${statView === "combined" ? "active" : ""}`}
              onClick={() => setStatView("combined")}
            >
              All
            </button>
            <button
              className={`stog ${statView === "claude" ? "active" : ""}`}
              onClick={() => setStatView("claude")}
            >
              Claude
            </button>
            <button
              className={`stog ${statView === "codex" ? "active" : ""}`}
              onClick={() => setStatView("codex")}
            >
              Codex
            </button>
          </div>
        )}
      </div>

      <div className={`card-scene ${cardTheme}`}>
        <div className="card-flipper" ref={flipperRef} style={{ opacity: 0 }}>
          {/* Single card — slides in/out */}
          <div
            className={`card-stack-item top card-holo ${nudging ? "nudge" : ""}`}
            data-rarity="radiant rare"
            style={{
              position: "absolute",
              inset: 0,
              zIndex: 5,
              transform: enteringFrom
                ? `translateX(${(enteringFrom === "left" ? -1 : 1) * 120}%) rotate(${(enteringFrom === "left" ? -1 : 1) * 12}deg)`
                : undefined,
              opacity: enteringFrom ? 0 : 1,
              transition: enteringFrom
                ? "none"
                : "transform 0.4s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.35s ease",
              borderRadius: "24px",
              overflow: "hidden",
            }}
          >
            <CardBg />
            <Slide
              page={currentPage}
              data={data}
              show={show}
              statView={statView}
              cardTheme={cardTheme}
              tier={tier}
              userName={userName}
              viewTokens={viewTokens}
              viewStreak={viewStreak}
              lvl={lvl}
              dailyDist={dailyDist}
              viewActiveDays={viewActiveDays}
              personality={personality}
              viewCost={viewCost}
              achievements={achievements}
              hourBars={hourBars}
              viewCacheSaved={viewCacheSaved}
              activityCategories={activityCategories}
              actCatColors={actCatColors}
              topTools={topTools}
              viewModels={viewModels}
              viewProjects={viewProjects}
              projectMapSize={projectMap.size}
              mostExpensive={mostExpensive}
            />
            <div className="card-holo-shine" aria-hidden="true" />
            <div className="card-holo-glare" aria-hidden="true" />
            {currentPage === 0 && (
              <div className={`card-splash ${phase >= 3 ? "hide" : ""}`}>
                <div className="splash-grid" />
                <div className="splash-glow" />
                <div className="splash-content">
                  <div className="splash-icon">
                    <svg
                      width="64"
                      height="64"
                      viewBox="0 0 120 125"
                      xmlns="http://www.w3.org/2000/svg"
                      shapeRendering="geometricPrecision"
                    >
                      <path
                        fill="#6e8a6f"
                        d="M75.288 0H8.988C8.488 0 7.788 0.5 7.788 1.1V23.4C7.788 23.9 8.188 24.6 8.888 24.6H73.988C79.288 24.6 84.088 26.3 87.388 28.9C92.088 32.6 94.588 37.9 94.588 43.6C95.088 54.1 87.288 62.8 77.888 64.7C76.088 65.3 72.888 66.3 61.588 66.3C61.188 66.3 60.688 66.6 60.488 67L50.488 90.6C50.188 91.2 50.688 92 51.388 92H73.188C81.288 92 88.888 90.8 95.988 87.2C105.488 82.4 119.288 70.7 119.288 48.3C119.388 25.8 104.388 11.4 92.988 4.2C87.188 1.4 82.388 0.2 75.288 0Z"
                      />
                      <path
                        fill="#6e8a6f"
                        d="M73.488 32.6H40.188C39.788 32.6 39.288 32.9 39.088 33.4L0.088 123.3C-0.212 124.1 0.288 124.9 1.088 124.9H26.688C27.188 124.9 27.688 124.6 27.788 124.2L54.988 59.1C55.188 58.7 55.588 58.3 55.988 58.3H73.488C81.188 58.3 86.488 53.2 86.588 46.2C86.788 39 81.588 32.6 73.488 32.6Z"
                      />
                      <path
                        fill="#6e8a6f"
                        d="M75.488 0H8.988C8.488 0 7.788 0.5 7.788 1.1V23.4C7.788 23.9 8.188 24.6 8.888 24.6H73.988C85.288 24.6 94.588 33 94.588 45.2C94.588 55.4 87.288 66.3 72.988 66.3H61.588C61.088 66.3 60.688 66.6 60.488 67L50.488 90.6C50.188 91.2 50.688 92 51.388 92H73.188C95.988 92 119.288 77.5 119.288 45.7C119.288 22.6 100.388 0.5 75.488 0Z"
                      />
                      <path
                        fill="#6e8a6f"
                        d="M38.888 33.8L0.088 123.3C-0.212 124 0.288 124.8 1.088 124.8H26.588C27.088 124.8 27.588 124.5 27.688 124.1L54.988 59.1C55.188 58.7 55.588 58.3 55.988 58.3H73.488C81.188 58.3 86.588 53.1 86.588 45.6C86.588 38.9 81.988 32.6 73.488 32.6H40.088C39.588 32.6 39.088 33 38.888 33.8Z"
                      />
                    </svg>
                  </div>
                  <div className="splash-brand">PELLAMETRIC</div>
                  <div className="splash-sub">illuminating your code</div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Navigation arrows — sides of card */}
      <button
        className={`card-nav-side card-nav-left ${showShare ? "show" : ""}`}
        onClick={handlePrevPage}
        title="Previous"
      >
        <ChevronLeft />
      </button>
      <button
        className={`card-nav-side card-nav-right ${showShare ? "show" : ""}`}
        onClick={handleNextPage}
        title="Next"
      >
        <ChevronRight />
      </button>

      {/* Page dots — below card */}
      <div className={`card-page-dots ${showShare ? "show" : ""}`}>
        {Array.from({ length: TOTAL_PAGES }, (_, i) => (
          <div
            key={i}
            className={`card-page-dot ${i === currentPage ? "active" : ""}`}
          />
        ))}
      </div>

      {/* Share bar hides in compact mode — no download/copy/share surface
          makes sense on the landing hero, where there's no real card to
          share yet. The full /card and /card/[id] pages keep it. */}
      {!compact && (
        <div className={`share-bar ${showShare ? "show" : ""}`}>
          <button className="sb" title="Download PNG" onClick={handleDownload}>
            <DownloadIcon />
          </button>
          <button
            className="sb"
            title="Copy image to clipboard"
            onClick={copyImage}
          >
            <CopyIcon />
          </button>
          <button className="sb" title="Share on X" onClick={shareOnTwitter}>
            <svg width="18" height="18" fill="currentColor" viewBox="0 0 24 24">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
            </svg>
          </button>
          <button
            className="sb"
            title="Share on LinkedIn"
            onClick={shareOnLinkedIn}
          >
            <svg width="18" height="18" fill="currentColor" viewBox="0 0 24 24">
              <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.852 3.37-1.852 3.601 0 4.268 2.37 4.268 5.455v6.288zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.063 2.063 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
            </svg>
          </button>
          {typeof navigator !== "undefined" && "share" in navigator && (
            <button
              className="sb"
              title="Share"
              onClick={async () => {
                try {
                  await navigator.share({
                    title: `${userName}'s Pellametric Card`,
                    text: "Where did my tokens go? @pellametric knows. Grab your card →",
                    url: window.location.href,
                  });
                } catch {
                  /* user cancelled */
                }
              }}
            >
              <ShareIcon />
            </button>
          )}
        </div>
      )}

      {/* Toast */}
      {toast && <div className="card-toast">{toast}</div>}
    </div>
  );
}
