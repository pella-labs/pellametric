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
  type AchievementIcon,
  type CardData,
  formatCost,
  formatTokens,
  getAchievements,
  getCacheSaved,
  getCodexPersonality,
  getHourBarColor,
  getLevel,
  getModelColors,
  getPersonality,
  getTier,
  getTotalTokens,
  mapPersonality,
  normalizeHours,
} from "./card-utils";
import "./card.css";
import "./holo.css";
import "./card-bematist.css";

/* ── Icons ── */
const FlameIcon = ({ size = 14, color = "#ff9f43" }: { size?: number; color?: string }) => (
  <svg
    style={{ width: size, height: size, color }}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
  </svg>
);
const WrenchIcon = ({ color }: { color: string }) => (
  <svg
    style={{ width: 14, height: 14, color }}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
  </svg>
);
const RocketIcon = ({ color }: { color: string }) => (
  <svg
    style={{ width: 14, height: 14, color }}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
    <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
    <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
    <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
  </svg>
);
const MonitorIcon = ({ color }: { color: string }) => (
  <svg
    style={{ width: 14, height: 14, color }}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M12 8V4H8" />
    <rect width="16" height="12" x="4" y="8" rx="2" />
    <path d="M2 14h2" />
    <path d="M20 14h2" />
    <path d="M15 13v2" />
    <path d="M9 13v2" />
  </svg>
);
const ChevronLeft = () => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="m15 18-6-6 6-6" />
  </svg>
);
const ChevronRight = () => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="m9 18 6-6-6-6" />
  </svg>
);
const DownloadIcon = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" x2="12" y1="15" y2="3" />
  </svg>
);
const ShareIcon = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
    <polyline points="16 6 12 2 8 6" />
    <line x1="12" x2="12" y1="2" y2="15" />
  </svg>
);
const CopyIcon = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect width="14" height="14" x="8" y="8" rx="2" />
    <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
  </svg>
);

function AchievementSvg({ icon, color }: { icon: AchievementIcon; color: string }) {
  switch (icon) {
    case "flame":
      return <FlameIcon size={14} color={color} />;
    case "wrench":
      return <WrenchIcon color={color} />;
    case "rocket":
      return <RocketIcon color={color} />;
    case "monitor":
      return <MonitorIcon color={color} />;
  }
}

const TOTAL_PAGES = 8;

// Section header with title + subtitle
const SectionHead = ({ title, sub }: { title: string; sub?: string }) => (
  <div className="sec-head">
    <div className="sec-title">{title}</div>
    {sub && <div className="sec-sub">{sub}</div>}
  </div>
);

function shortModelName(name: string): string {
  // Claude
  if (name.includes("opus-4-7")) return "Opus 4.7";
  if (name.includes("opus-4-6")) return "Opus 4.6";
  if (name.includes("opus-4-5")) return "Opus 4.5";
  if (name.includes("opus-4")) return "Opus 4";
  if (name.includes("3-opus") || name.includes("claude-3-opus")) return "Opus 3";
  if (name.includes("opus")) return "Opus";
  if (name.includes("sonnet-4-7")) return "Sonnet 4.7";
  if (name.includes("sonnet-4-6")) return "Sonnet 4.6";
  if (name.includes("sonnet-4-5")) return "Sonnet 4.5";
  if (name.includes("sonnet-4")) return "Sonnet 4";
  if (name.includes("3-5-sonnet") || name.includes("3.5-sonnet")) return "Sonnet 3.5";
  if (name.includes("sonnet")) return "Sonnet";
  if (name.includes("haiku-4-5")) return "Haiku 4.5";
  if (name.includes("haiku-4")) return "Haiku 4";
  if (name.includes("haiku")) return "Haiku 3.5";
  // OpenAI / Codex — longest-match first (spark/mini must come before generic codex)
  if (name.includes("codex-spark")) return "Codex Spark";
  if (name.includes("codex-mini")) return "Codex Mini";
  if (name.includes("gpt-5.3-codex")) return "Codex 5.3";
  if (name.includes("gpt-5.2-codex")) return "Codex 5.2";
  if (name.includes("gpt-5.1-codex")) return "Codex 5.1";
  if (name.includes("gpt-5.4")) return "GPT-5.4";
  if (name.includes("gpt-5")) return "GPT-5";
  if (name.includes("gpt-4o-mini")) return "GPT-4o mini";
  if (name.includes("gpt-4o")) return "GPT-4o";
  if (name.includes("gpt-4")) return "GPT-4";
  if (name.startsWith("o3-mini")) return "o3-mini";
  if (name.startsWith("o3")) return "o3";
  if (name.startsWith("o4-mini")) return "o4-mini";
  // Google
  if (name.includes("gemini-1.5-pro")) return "Gemini 1.5 Pro";
  if (name.includes("gemini-pro")) return "Gemini Pro";
  // Cursor's own
  if (name.includes("cursor-small")) return "Cursor Small";
  if (name.includes("cursor-fast")) return "Cursor Fast";
  if (name === "unknown") return "Unknown";
  return name;
}

const toolDisplayNames: Record<string, { name: string; desc: string }> = {
  // Claude Code tools
  Bash: { name: "Bash", desc: "Terminal commands" },
  Read: { name: "Read", desc: "Reading files" },
  Edit: { name: "Edit", desc: "Editing code" },
  Write: { name: "Write", desc: "Creating files" },
  Grep: { name: "Grep", desc: "Searching code" },
  Glob: { name: "Glob", desc: "Finding files" },
  Agent: { name: "Agent", desc: "Sub-agents" },
  WebSearch: { name: "Web Search", desc: "Searching the web" },
  WebFetch: { name: "Web Fetch", desc: "Fetching URLs" },
  Skill: { name: "Skill", desc: "Skill invocations" },
  TodoWrite: { name: "Todo", desc: "Task tracking" },
  TaskCreate: { name: "Tasks", desc: "Creating tasks" },
  TaskUpdate: { name: "Tasks", desc: "Updating tasks" },
  ToolSearch: { name: "Tool Search", desc: "Finding tools" },
  // Codex tools
  exec_command: { name: "Run Command", desc: "Terminal execution" },
  apply_patch: { name: "Apply Patch", desc: "Code changes" },
  write_stdin: { name: "Write Input", desc: "Interactive input" },
  shell_command: { name: "Shell", desc: "Shell commands" },
  shell: { name: "Shell", desc: "Shell execution" },
  read_file: { name: "Read File", desc: "Reading files" },
  write_file: { name: "Write File", desc: "Creating files" },
  list_directory: { name: "List Dir", desc: "Browsing folders" },
  search_files: { name: "Search", desc: "Searching code" },
  web_search: { name: "Web Search", desc: "Searching the web" },
};

function getToolDisplay(rawName: string): { name: string; desc: string } {
  // Check exact match
  const exact = toolDisplayNames[rawName];
  if (exact) return exact;
  // Check MCP tools: mcp__ServerName__tool_name
  const mcpMatch = rawName.match(/^mcp__([^_]+)__(.+)$/);
  if (mcpMatch?.[1] && mcpMatch[2]) {
    const tool = mcpMatch[2].replace(/_/g, " ");
    return {
      name: tool.charAt(0).toUpperCase() + tool.slice(1),
      desc: `${mcpMatch[1]} MCP`,
    };
  }
  // Fallback: clean up snake_case/camelCase
  const cleaned = rawName.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2");
  return { name: cleaned.charAt(0).toUpperCase() + cleaned.slice(1), desc: "" };
}

function cleanProjectName(name: string): string {
  const parts = name.split("-").filter(Boolean);
  return parts[parts.length - 1] || name;
}

function getDailyColor(
  intensity: number,
  _hasClaude: boolean,
  _hasCodex: boolean,
  isCream = false,
): string {
  if (intensity === 0) return isCream ? "rgba(0,0,0,.03)" : "rgba(255,255,255,.02)";
  if (intensity > 0.75) return "#b8d8a1";
  if (intensity > 0.5) return "#8fb078";
  if (intensity > 0.25) return "#6e8a6f";
  if (intensity > 0.1) return "#52715a";
  return "#3a5a45";
}

export function CardPage({
  demoData,
  compact = false,
}: {
  demoData?: CardData;
  compact?: boolean;
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
  const [enteringFrom, setEnteringFrom] = useState<"left" | "right" | null>(null);
  const [statView, setStatView] = useState<"combined" | "claude" | "codex">("combined");
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
      const px = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
      const py = Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100));
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
    if (phase < 2 || exitingPage || enteringFrom || currentPage >= TOTAL_PAGES - 1) return;
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
    // Hook → product namecheck → CTA. @bematist_dev threads the tweet
    // under the profile; the URL carries the sharer's card so viewers
    // see the stats in the card preview, then click through to mint
    // their own.
    const text = encodeURIComponent(
      `Where did my tokens go? @bematist_dev knows. Grab your card \u2192`,
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
      const dataUrl = await toPng(face, {
        pixelRatio: 2,
        backgroundColor: "#0d1117",
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
      link.download = `bematist-card-${currentPage + 1}.png`;
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
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
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
  const userName = data.user?.displayName || "Developer";
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
  const projectMap = new Map<string, { sessions: number; cost: number; source: string }>();
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
  const mostExpensive = hl?.mostExpensiveSession;
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
    statView === "codex" ? (s.codex.activeDays ?? 0) : (hl?.longestStreak ?? s.claude.activeDays);

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
      : (statView === "claude" ? (s.claude.projects ?? []) : (s.codex.projects ?? []))
          .map((p) => ({
            name: cleanProjectName(p.name),
            sessions: p.sessions,
            cost: p.cost,
            source: statView,
          }))
          .sort((a, b) => b.cost - a.cost)
          .slice(0, 8);

  const show = phase >= 3;

  // Page footer with dots
  const renderPage = (page: number) => {
    switch (page) {
      case 0:
        return (
          <div className="card-content">
            <div className={`top-row reveal ${show ? "show" : ""}`}>
              <div className="brand">BEMATIST</div>
              <div className="tier">{tier}</div>
            </div>
            <div className={`reveal ${show ? "show" : ""}`} style={{ transitionDelay: "130ms" }}>
              <div className="user-name">{userName}</div>
              <div className="user-sub">
                {data.user?.githubUsername ? `@${data.user.githubUsername}` : ""}
              </div>
            </div>
            <div
              className={`hero reveal ${show ? "show" : ""}`}
              style={{ transitionDelay: "260ms" }}
            >
              <div className="hero-label">Tokens Generated</div>
              <div className="hero-num">
                <span>{formatTokens(viewTokens)}</span>
                <span className="hero-unit">tokens</span>
              </div>
            </div>
            <div className={`reveal ${show ? "show" : ""}`} style={{ transitionDelay: "390ms" }}>
              <div className="streak-level">
                <div className="streak">
                  <FlameIcon /> {viewStreak} day streak
                </div>
                <div className="sep" />
                <div className="lvl-t">
                  Lvl {lvl.level} {"\u00B7"} {lvl.title}
                </div>
              </div>
              <div className="lvl-track">
                <div
                  className={`lvl-fill ${show ? "go" : ""}`}
                  style={{ "--lvl-pct": `${lvl.pct}%` } as React.CSSProperties}
                />
              </div>
            </div>
            {/* GitHub contribution graph */}
            <div
              className={`reveal ${show ? "show" : ""}`}
              style={{ transitionDelay: "520ms", marginTop: "auto" }}
            >
              <div className="gh-heatmap">
                {(() => {
                  // Always render a fixed 7 × 22 grid (last ~22 weeks), regardless of how sparse the data is.
                  const WEEKS = 22;
                  const endDate = new Date();
                  endDate.setHours(12, 0, 0, 0);
                  // Grid ends on Saturday of current week; walk back to find the Sunday that starts the 22nd-prev week.
                  const gridEnd = new Date(endDate);
                  gridEnd.setDate(endDate.getDate() + (6 - endDate.getDay()));
                  const gridStart = new Date(gridEnd);
                  gridStart.setDate(gridEnd.getDate() - (WEEKS * 7 - 1));
                  const rangeStartKey = gridStart.toISOString().split("T")[0] ?? "";
                  const rangeEndKey = endDate.toISOString().split("T")[0] ?? "";
                  const dayMap = new Map(dailyDist.map((d) => [d.date, d]));
                  const cells: Array<{
                    date: string;
                    sessions: number;
                    claude: number;
                    codex: number;
                    inRange: boolean;
                  }> = [];
                  const cursor = new Date(gridStart);
                  for (let i = 0; i < WEEKS * 7; i++) {
                    const key = cursor.toISOString().split("T")[0] ?? "";
                    const d = dayMap.get(key);
                    const ss = d
                      ? statView === "claude"
                        ? d.claudeSessions
                        : statView === "codex"
                          ? d.codexSessions
                          : d.sessions
                      : 0;
                    cells.push({
                      date: key,
                      sessions: ss,
                      claude: d?.claudeSessions ?? 0,
                      codex: d?.codexSessions ?? 0,
                      inRange: key >= rangeStartKey && key <= rangeEndKey,
                    });
                    cursor.setDate(cursor.getDate() + 1);
                  }
                  const maxS = Math.max(...cells.map((c) => c.sessions), 1);
                  return (
                    <div className="gh-grid-wrap">
                      <div className="gh-day-labels">
                        {["", "M", "", "W", "", "F", ""].map((l, i) => (
                          <span key={i}>{l}</span>
                        ))}
                      </div>
                      <div
                        className="gh-grid"
                        style={{ gridTemplateColumns: `repeat(${WEEKS}, 1fr)` }}
                      >
                        {Array.from({ length: WEEKS }, (_, col) =>
                          Array.from({ length: 7 }, (_, row) => {
                            const cell = cells[col * 7 + row];
                            if (!cell) return null;
                            const intensity = cell.sessions / maxS;
                            const hasClaude = statView !== "codex" && cell.claude > 0;
                            const hasCodex = statView !== "claude" && cell.codex > 0;
                            const label = new Date(`${cell.date}T12:00:00`).toLocaleDateString(
                              "en-US",
                              {
                                month: "short",
                                day: "numeric",
                              },
                            );
                            return (
                              <div
                                key={`${col}-${row}`}
                                className="gh-cell"
                                title={cell.inRange ? `${label}: ${cell.sessions} sessions` : ""}
                                style={{
                                  background:
                                    cell.sessions === 0
                                      ? undefined
                                      : getDailyColor(
                                          intensity,
                                          hasClaude,
                                          hasCodex,
                                          cardTheme === "cream",
                                        ),
                                  gridRow: row + 1,
                                  gridColumn: col + 1,
                                }}
                              />
                            );
                          }),
                        )}
                      </div>
                    </div>
                  );
                })()}
              </div>
              <div className="gh-legend">
                <span>{viewActiveDays} active days</span>
              </div>
            </div>
          </div>
        );

      case 1:
        return (
          <div className="card-content">
            <div className="top-row">
              <div className="brand">BEMATIST</div>
              <div className="page-title">Identity</div>
            </div>
            <div className="wrap-insight">
              <div className="wrap-emoji">
                {personality.name.includes("Midnight")
                  ? "\u{1F319}"
                  : personality.name.includes("Dawn")
                    ? "\u{1F305}"
                    : personality.name.includes("Twilight")
                      ? "\u{1F307}"
                      : personality.name.includes("Relentless")
                        ? "\u{26A1}"
                        : personality.name.includes("Weekend")
                          ? "\u{1F3D6}"
                          : "\u{2600}\u{FE0F}"}
              </div>
              <div className="wrap-lead">You are a</div>
              <div className="wrap-hero">{personality.name}</div>
              {personality.desc && (
                <div className="wrap-sub" style={{ color: "#64748b", fontSize: 12 }}>
                  {personality.desc}
                </div>
              )}
            </div>
            <div className="p2-stats">
              <div className="p2-stat">
                <span className="p2-stat-val purple">{formatTokens(viewTokens)}</span>
                <span className="p2-stat-lbl">tokens</span>
              </div>
              <div className="p2-stat-sep" />
              <div className="p2-stat">
                <span className="p2-stat-val blue">{formatCost(viewCost)}</span>
                <span className="p2-stat-lbl">spent</span>
              </div>
              <div className="p2-stat-sep" />
              <div className="p2-stat">
                <span className="p2-stat-val green">{viewActiveDays}d</span>
                <span className="p2-stat-lbl">active</span>
              </div>
            </div>
            {achievements.length > 0 && (
              <div className="p2-badges">
                <div className="p2-badges-title">Badges Earned</div>
                <div className="p2-badge-row">
                  {achievements.slice(0, 4).map((a) => (
                    <div className="p2-pill" key={a.name}>
                      <AchievementSvg icon={a.icon} color={a.color} />
                      <span>{a.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );

      case 2:
        return (
          <div className="card-content">
            <div className="top-row" style={{ marginBottom: 20 }}>
              <div className="brand">BEMATIST</div>
              <div className="page-title">Activity</div>
            </div>
            {statView !== "codex" ? (
              <>
                <SectionHead
                  title="Activity by Hour"
                  sub="When you code the most throughout the day"
                />
                <div className="hour-chart" style={{ height: 100, marginBottom: 4 }}>
                  {hourBars.map((val, i) => (
                    <div
                      key={i}
                      className="hour-bar pop"
                      style={{
                        height: `${Math.max(val * 100, 5)}%`,
                        background: getHourBarColor(val),
                      }}
                    />
                  ))}
                </div>
                <div className="hour-labels">
                  <span>12am</span>
                  <span>6am</span>
                  <span>12pm</span>
                  <span>6pm</span>
                  <span>11pm</span>
                </div>
              </>
            ) : (
              <>
                <div className="hm-ti" style={{ marginBottom: 8 }}>
                  Codex Insights
                </div>
                <div
                  className="stats"
                  style={{
                    gridTemplateColumns: "repeat(3, 1fr)",
                    marginBottom: 8,
                  }}
                >
                  <div className="sc">
                    <div className="sc-l">Tool Calls</div>
                    <div className="sc-v purple">
                      {(s.codex.totalToolCalls ?? 0).toLocaleString()}
                    </div>
                  </div>
                  <div className="sc">
                    <div className="sc-l">Reasoning</div>
                    <div className="sc-v blue">
                      {(s.codex.totalReasoningBlocks ?? 0).toLocaleString()}
                    </div>
                  </div>
                  <div className="sc">
                    <div className="sc-l">Web Searches</div>
                    <div className="sc-v green">
                      {(s.codex.totalWebSearches ?? 0).toLocaleString()}
                    </div>
                  </div>
                </div>
              </>
            )}
            <div className="cost-hero" style={{ marginTop: 20 }}>
              <div>
                <div
                  style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 32,
                    fontWeight: 700,
                    color: cardTheme === "cream" ? "#1a1a2e" : "#e2e8f0",
                    lineHeight: 1,
                  }}
                >
                  {formatCost(viewCost)}
                </div>
                <div className="sc-l" style={{ fontSize: 10, marginTop: 6 }}>
                  total spend
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div
                  style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 32,
                    fontWeight: 700,
                    color: cardTheme === "cream" ? "#3a9a7a" : "#6e8a6f",
                    lineHeight: 1,
                  }}
                >
                  {viewCacheSaved}
                </div>
                <div className="sc-l" style={{ fontSize: 10, marginTop: 6 }}>
                  saved by caching
                </div>
              </div>
            </div>
            {activityCategories.length > 0 && (
              <>
                <SectionHead title="How You Use AI" sub="What type of work your AI agent does" />
                <div className="tb go" style={{ height: 10 }}>
                  {activityCategories.map((cat, i) => (
                    <div
                      key={cat.category}
                      style={{
                        flex: cat.sessionPct,
                        background: actCatColors[i % actCatColors.length],
                        borderRadius: 3,
                      }}
                    />
                  ))}
                </div>
                <div className="tb-leg" style={{ marginTop: 20 }}>
                  {activityCategories.map((cat, i) => (
                    <span
                      key={cat.category}
                      style={{ display: "flex", alignItems: "center", gap: 3 }}
                    >
                      <span
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: 2,
                          background: actCatColors[i % actCatColors.length],
                          display: "inline-block",
                        }}
                      />
                      {cat.category} {cat.sessionPct}%
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>
        );

      case 3:
        return (
          <div className="card-content">
            <div className="top-row">
              <div className="brand">BEMATIST</div>
              <div className="page-title">Tools</div>
            </div>
            {(() => {
              const viewTools =
                statView === "codex"
                  ? (s.codex.topTools ?? []).slice(0, 5)
                  : statView === "claude"
                    ? topTools
                    : topTools;
              if (viewTools.length === 0)
                return (
                  <div
                    style={{
                      padding: "20px 0",
                      textAlign: "center",
                      color: cardTheme === "cream" ? "rgba(26,26,46,.25)" : "rgba(255,255,255,.25)",
                      fontSize: 11,
                    }}
                  >
                    No tool data available
                  </div>
                );
              const top = viewTools[0];
              if (!top) return null;
              const topDisplay = getToolDisplay(top.name);
              const rest = viewTools.slice(1);
              return (
                <>
                  <SectionHead title="Top Tools" sub="Most used capabilities by your AI agent" />
                  {/* Hero: #1 tool */}
                  <div className="tool-hero">
                    <div className="tool-hero-rank">#1</div>
                    <div className="tool-hero-name">{topDisplay.name}</div>
                    <div className="tool-hero-count">{formatTokens(top.count)}</div>
                    <div className="tool-hero-desc">{topDisplay.desc || "calls"}</div>
                  </div>
                  {/* Rest as grid */}
                  <div className="tool-grid">
                    {rest.map((t, i) => {
                      const display = getToolDisplay(t.name);
                      return (
                        <div className="tool-card" key={t.name}>
                          <div className="tool-card-rank">#{i + 2}</div>
                          <div className="tool-card-name">{display.name}</div>
                          <div className="tool-card-count">{formatTokens(t.count)}</div>
                          {display.desc && <div className="tool-card-desc">{display.desc}</div>}
                        </div>
                      );
                    })}
                  </div>
                </>
              );
            })()}
          </div>
        );

      case 4: {
        // Determine which agent logo to show based on top model
        const topModelName = viewModels[0]?.name?.toLowerCase() ?? "";
        const isClaude =
          topModelName.includes("opus") ||
          topModelName.includes("sonnet") ||
          topModelName.includes("haiku");
        const isCodex = topModelName.includes("codex") || topModelName.includes("gpt");
        const agentLogo = isClaude ? "/claudecode-color.svg" : isCodex ? "/codex-color.svg" : null;

        return (
          <div className="card-content" style={{ position: "relative", overflow: "hidden" }}>
            {/* Agent logo overlay — big, centered, transparent */}
            {agentLogo && (
              <img
                src={agentLogo}
                alt=""
                style={{
                  position: "absolute",
                  top: "50%",
                  left: "50%",
                  transform: "translate(-50%, -50%)",
                  width: "65%",
                  height: "auto",
                  opacity: cardTheme === "cream" ? 0.06 : 0.08,
                  pointerEvents: "none",
                  zIndex: 0,
                }}
              />
            )}
            <div style={{ position: "relative", zIndex: 1 }}>
              <div className="top-row">
                <div className="brand">BEMATIST</div>
                <div className="page-title">Models</div>
              </div>
              <SectionHead title="Your Favorite Model" sub="The AI model you used the most" />
              {/* Hero model */}
              <div className="wrap-insight">
                <div className="wrap-emoji">
                  {isClaude ? (
                    <img
                      src="/claudecode-color.svg"
                      alt="Claude"
                      style={{ width: 32, height: 32 }}
                    />
                  ) : isCodex ? (
                    <img src="/codex-color.svg" alt="Codex" style={{ width: 32, height: 32 }} />
                  ) : (
                    <svg
                      width="32"
                      height="32"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke={cardTheme === "cream" ? "#7a6299" : "#8fb078"}
                      strokeWidth={1.5}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M12 2L2 7l10 5 10-5-10-5z" />
                      <path d="M2 17l10 5 10-5" />
                      <path d="M2 12l10 5 10-5" />
                    </svg>
                  )}
                </div>
                <div className="wrap-lead">You love to work with</div>
                <div className="wrap-hero">
                  {viewModels[0] ? shortModelName(viewModels[0].name) : "Unknown"}
                </div>
                <div className="wrap-sub">
                  {viewModels[0]?.sessions.toLocaleString() ?? 0} sessions {"\u00B7"}{" "}
                  {viewModels[0] ? formatCost(viewModels[0].cost) : "$0"} spent
                </div>
              </div>
              {/* Other models */}
              {/* <SectionHead title="Also powered by" sub={`${viewModels.length} models used in total`} /> */}
              <div className="wrap-others" style={{ marginTop: 15 }}>
                {viewModels.slice(1).map((m, i) => {
                  const mLower = m.name.toLowerCase();
                  const mIsClaude =
                    mLower.includes("opus") ||
                    mLower.includes("sonnet") ||
                    mLower.includes("haiku");
                  const mIsCodex = mLower.includes("codex") || mLower.includes("gpt");
                  return (
                    <div className="wrap-other" key={m.name}>
                      <div
                        className="wrap-other-rank"
                        style={{
                          fontSize: 14,
                          color: "#6e8a6f",
                          fontWeight: 800,
                        }}
                      >
                        #{i + 2}
                      </div>
                      {mIsClaude ? (
                        <img src="/claudecode-color.svg" alt="" style={{ width: 10, height: 10 }} />
                      ) : mIsCodex ? (
                        <img src="/codex-color.svg" alt="" style={{ width: 10, height: 10 }} />
                      ) : (
                        <div
                          className="mdot"
                          style={{
                            background: getModelColors(m.name),
                            width: 8,
                            height: 8,
                          }}
                        />
                      )}
                      <span className="wrap-other-name">{shortModelName(m.name)}</span>
                      <span className="wrap-other-val">{formatCost(m.cost)}</span>
                      <span className="wrap-other-sessions">{m.sessions.toLocaleString()}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        );
      }

      case 5:
        return (
          <div className="card-content">
            <div className="top-row">
              <div className="brand">BEMATIST</div>
              <div className="page-title">Projects</div>
            </div>
            <SectionHead title="Your Top Project" sub="Where you spent the most time with AI" />
            <div className="wrap-insight" style={{ paddingBottom: 16 }}>
              <div className="wrap-emoji">
                <svg
                  width="32"
                  height="32"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke={cardTheme === "cream" ? "#7a6299" : "#8fb078"}
                  strokeWidth={1.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                </svg>
              </div>
              <div className="wrap-lead">You built the most in</div>
              <div className="wrap-hero">{viewProjects[0]?.name ?? "Unknown"}</div>
              <div className="wrap-sub">
                {viewProjects[0]?.sessions.toLocaleString() ?? 0} sessions {"\u00B7"}{" "}
                {viewProjects[0] ? formatCost(viewProjects[0].cost) : "$0"} spent
              </div>
            </div>
            {/* <SectionHead title="Also worked on" sub="" /> */}
            <div className="wrap-others">
              {viewProjects.slice(1, 5).map((p, i) => (
                <div className="wrap-other" key={p.name}>
                  <div
                    className="wrap-other-rank"
                    style={{ fontSize: 14, color: "#6e8a6f", fontWeight: 800 }}
                  >
                    #{i + 2}
                  </div>
                  <div
                    className="mdot"
                    style={{
                      background: p.source === "codex" ? "#8fb078" : "#8fb078",
                      width: 8,
                      height: 8,
                    }}
                  />
                  <span className="wrap-other-name">{p.name}</span>
                  <span className="wrap-other-val">{formatCost(p.cost)}</span>
                </div>
              ))}
            </div>
          </div>
        );

      case 6: {
        // ─── Analytics page ───
        const viewToolCalls =
          statView === "claude"
            ? (s.claude.totalToolCalls ?? 0)
            : statView === "codex"
              ? (s.codex.totalToolCalls ?? 0)
              : (s.claude.totalToolCalls ?? 0) + (s.codex.totalToolCalls ?? 0);
        const viewSessions =
          statView === "claude"
            ? s.claude.sessions
            : statView === "codex"
              ? s.codex.sessions
              : s.combined.totalSessions;
        const daily = dailyDist
          .map((d) => ({
            date: d.date,
            cost:
              statView === "claude"
                ? (d.claudeSessions / Math.max(d.sessions, 1)) * d.cost
                : statView === "codex"
                  ? (d.codexSessions / Math.max(d.sessions, 1)) * d.cost
                  : d.cost,
          }))
          .filter((d) => !Number.isNaN(d.cost));
        const maxCost = Math.max(...daily.map((d) => d.cost), 0.001);
        const firstDate = daily[0]?.date
          ? new Date(`${daily[0].date}T12:00:00`).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
            })
          : "";
        const lastDaily = daily[daily.length - 1];
        const lastDate = lastDaily?.date
          ? new Date(`${lastDaily.date}T12:00:00`).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
            })
          : "";
        const chartW = 324;
        const chartH = 84;
        const linePath =
          daily.length > 1
            ? daily
                .map((d, i) => {
                  const x = (i / (daily.length - 1)) * chartW;
                  const y = chartH - (d.cost / maxCost) * chartH;
                  return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
                })
                .join(" ")
            : "";
        const areaPath = linePath ? `${linePath} L${chartW},${chartH} L0,${chartH} Z` : "";
        const projBars = viewProjects.slice(0, 5);
        const projMax = Math.max(...projBars.map((p) => p.cost), 0.001);
        const peakCost = Math.max(...daily.map((d) => d.cost), 0);
        const peakIdx = daily.findIndex((d) => d.cost === peakCost);
        const peakDate =
          peakIdx >= 0 && daily[peakIdx]?.date
            ? new Date(`${daily[peakIdx].date}T12:00:00`).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
              })
            : "";
        return (
          <div className="card-content">
            <div className="top-row">
              <div className="brand">BEMATIST</div>
              <div className="page-title">Analytics</div>
            </div>
            <SectionHead title="Analytics" sub="Session costs and activity patterns" />
            <div className="an-stats">
              <div className="an-stat">
                <span className="an-stat-val">{viewSessions.toLocaleString()}</span>
                <span className="an-stat-lbl">Sessions</span>
              </div>
              <div className="an-stat">
                <span className="an-stat-val blue">{formatCost(viewCost)}</span>
                <span className="an-stat-lbl">Cost</span>
              </div>
              <div className="an-stat">
                <span className="an-stat-val purple">{formatTokens(viewTokens)}</span>
                <span className="an-stat-lbl">Tokens</span>
              </div>
              <div className="an-stat">
                <span className="an-stat-val green">{formatTokens(viewToolCalls)}</span>
                <span className="an-stat-lbl">Tool Calls</span>
              </div>
            </div>
            <div className="an-section">
              <div className="an-section-head">
                <span className="an-section-title">Cost Over Time</span>
                {peakDate && (
                  <span className="an-section-meta">
                    peak {formatCost(peakCost)} {"\u00B7"} {peakDate}
                  </span>
                )}
              </div>
              <div className="an-chart-wrap">
                {linePath ? (
                  <svg
                    width="100%"
                    height={chartH}
                    viewBox={`0 0 ${chartW} ${chartH}`}
                    preserveAspectRatio="none"
                    className="an-chart"
                  >
                    <defs>
                      <linearGradient id="an-fill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#8fb078" stopOpacity="0.35" />
                        <stop offset="100%" stopColor="#8fb078" stopOpacity="0" />
                      </linearGradient>
                    </defs>
                    <path d={areaPath} fill="url(#an-fill)" />
                    <path
                      d={linePath}
                      fill="none"
                      stroke="#8fb078"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : (
                  <div className="an-chart-empty">Not enough data yet</div>
                )}
                <div className="an-chart-labels">
                  <span>{firstDate}</span>
                  <span>{lastDate}</span>
                </div>
              </div>
            </div>
            <div className="an-section">
              <div className="an-section-head">
                <span className="an-section-title">Cost by Project</span>
                <span className="an-section-meta">{projectMap.size} projects</span>
              </div>
              <div className="an-bars">
                {projBars.map((p) => (
                  <div className="an-bar-row" key={p.name}>
                    <span className="an-bar-label">{p.name}</span>
                    <div className="an-bar-track">
                      <div
                        className={`an-bar-fill ${show ? "go" : ""}`}
                        style={
                          {
                            "--an-bar-pct": `${(p.cost / projMax) * 100}%`,
                          } as React.CSSProperties
                        }
                      />
                    </div>
                    <span className="an-bar-val">{formatCost(p.cost)}</span>
                  </div>
                ))}
                {projBars.length === 0 && <div className="an-chart-empty">No projects yet</div>}
              </div>
            </div>
          </div>
        );
      }

      case 7:
        return (
          <div className="card-content">
            <div className="top-row">
              <div className="brand">BEMATIST</div>
              <div className="page-title">Summary</div>
            </div>
            <SectionHead title="Your Coding Journey" sub="Everything at a glance" />
            <div className="sum-grid">
              <div className="sum-card">
                <div
                  className="sum-val"
                  style={{
                    color: cardTheme === "cream" ? "#1a1a2e" : "#e2e8f0",
                  }}
                >
                  {formatTokens(viewTokens)}
                </div>
                <div className="sum-label">tokens generated</div>
              </div>
              <div className="sum-card">
                <div className="sum-val" style={{ color: "#6e8a6f" }}>
                  {formatCost(viewCost)}
                </div>
                <div className="sum-label">total spent</div>
              </div>
              <div className="sum-card">
                <div className="sum-val" style={{ color: "#6e8a6f" }}>
                  {viewCacheSaved}
                </div>
                <div className="sum-label">saved by caching</div>
              </div>
              <div className="sum-card">
                <div className="sum-val" style={{ color: "#b07b3e" }}>
                  {viewActiveDays}d
                </div>
                <div className="sum-label">active</div>
              </div>
            </div>
            {mostExpensive && (
              <div className="sum-callout">
                <div className="sum-callout-label">Biggest single session</div>
                <div className="sum-callout-val">{formatCost(mostExpensive.cost)}</div>
                <div className="sum-callout-project">
                  {cleanProjectName(mostExpensive.project)} {"\u00B7"} {mostExpensive.date}
                </div>
              </div>
            )}
            <div className="sum-footer">
              <div className="sum-tagline">illuminate your code</div>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

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
        {/* theme toggle hidden for now
        <button className="theme-toggle" onClick={() => setCardTheme(t => t === 'cream' ? 'dark' : 'cream')} title={cardTheme === 'cream' ? 'Switch to dark' : 'Switch to cream'}>
          {cardTheme === 'cream' ? <MoonIcon /> : <SunIcon />}
        </button>
        */}
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
            {renderPage(currentPage)}
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
                      viewBox="57 34 48 64"
                      xmlns="http://www.w3.org/2000/svg"
                      shapeRendering="geometricPrecision"
                    >
                      <path
                        fill="#6e8a6f"
                        paintOrder="stroke fill"
                        fillRule="evenodd"
                        d="M58.2 49c.4-6.4 5.6-12.6 12.6-12.9h18.6c7.4.1 12.8 5.7 12.8 13.3v5.1c-.3 3.4-1.7 6.2-4.5 8.4 2.5 1.5 4.6 3.9 4.8 7.4v7.2c-.4 5.7-4.6 10.9-11.5 11.3H71.2V97h-13zm3.1.5v44.4H68v-8.5h22.1c5.1 0 9-3.7 9.3-8.2v-6.4c-.1-4.2-4.7-5.9-8.9-7.7 3.8-1.2 8.3-3.7 8.7-8.9v-4.7c-.1-5-4.3-10.3-10.5-10.3H71.6c-4.6 0-10 3.8-10.3 9.7zm6.8-.6c.1-2 1.4-3.2 3.3-3.2h15.9c2.8 0 5.1 1.6 5.2 4.5V54c-.1 2.9-2.2 4.8-4.9 4.9h-6.9v6.6h6.2c3 .1 5.7 1.8 5.9 5.2V76c-.2 1.6-1.2 3-3.3 3H68.1zm3.1 27.3H89c.4 0 .6-.2.7-.5v-4.6c-.1-1.5-1.2-2.6-3-2.6h-9.1V55.8h9.6c1.2 0 2-.7 2.1-1.8v-3.5c0-1.1-.9-1.9-2.1-1.9H71.8c-.4 0-.7.3-.6.7z"
                      />
                    </svg>
                  </div>
                  <div className="splash-brand">BEMATIST</div>
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
          <div key={i} className={`card-page-dot ${i === currentPage ? "active" : ""}`} />
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
          <button className="sb" title="Copy image to clipboard" onClick={copyImage}>
            <CopyIcon />
          </button>
          <button className="sb" title="Share on X" onClick={shareOnTwitter}>
            <svg width="18" height="18" fill="currentColor" viewBox="0 0 24 24">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
            </svg>
          </button>
          <button className="sb" title="Share on LinkedIn" onClick={shareOnLinkedIn}>
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
                    title: `${userName}'s Bematist Card`,
                    text: "Where did my tokens go? @bematist_dev knows. Grab your card →",
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
