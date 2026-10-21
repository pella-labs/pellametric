"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { SlideShell } from "../components/slide-shell";

/**
 * Problem → solution, one slide.
 *   OFF — four dev-machine AI sources dump tokens into a dead-end black box.
 *         Everything on the slide is grayed out, nothing pulses.
 *   ON  — pellametric lights the whole slide up: pulse dots stream along the
 *         connection paths, outcomes show values. A one-shot sweep animates
 *         across the stage on each OFF→ON flip.
 *
 * Layout is anchored to a shared vertical midline so every column is on the
 * same optical centre. No in-slide eyebrow — SlideShell already renders the
 * section label in the top chrome bar.
 */

// ── Brand marks ──────────────────────────────────────────────────────
function ClaudeMark({ size = 32 }: { size?: number }) {
  return (
    <Image
      src="/claudecode-color.svg"
      alt=""
      width={size}
      height={size}
      aria-hidden
      style={{ display: "block" }}
    />
  );
}
function CodexMark({ size = 32 }: { size?: number }) {
  return (
    <Image
      src="/codex-color.svg"
      alt=""
      width={size}
      height={size}
      aria-hidden
      style={{ display: "block" }}
    />
  );
}
function CursorMark({ size = 32 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden
      focusable="false"
    >
      <title>Cursor</title>
      <path d="M4 3L20 12L12 13L11 21L4 3Z" fill="#ede8de" />
    </svg>
  );
}
function GithubMark({ size = 32 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden
      focusable="false"
    >
      <title>GitHub</title>
      <path
        fill="#ede8de"
        d="M12 .5C5.73.5.67 5.57.67 11.84c0 5.01 3.24 9.26 7.75 10.76.56.1.77-.25.77-.55v-1.92c-3.15.69-3.82-1.52-3.82-1.52-.52-1.32-1.26-1.67-1.26-1.67-1.03-.71.08-.7.08-.7 1.14.08 1.74 1.18 1.74 1.18 1.01 1.74 2.66 1.24 3.31.94.1-.74.4-1.24.72-1.52-2.51-.29-5.15-1.26-5.15-5.6 0-1.24.44-2.25 1.17-3.05-.12-.29-.51-1.45.11-3.02 0 0 .96-.31 3.14 1.17a10.9 10.9 0 0 1 2.86-.39c.97 0 1.95.13 2.86.39 2.18-1.48 3.14-1.17 3.14-1.17.62 1.57.23 2.73.11 3.02.73.8 1.17 1.81 1.17 3.05 0 4.36-2.65 5.31-5.17 5.59.41.35.77 1.04.77 2.1v3.12c0 .3.21.66.78.55 4.5-1.5 7.75-5.75 7.75-10.76C23.33 5.57 18.27.5 12 .5Z"
      />
    </svg>
  );
}

// ── Generic concept icons ────────────────────────────────────────────
const ip = {
  fill: "none" as const,
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};
function IconGitMerge({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden {...ip}>
      <circle cx={6} cy={5.5} r={2} />
      <circle cx={6} cy={18.5} r={2} />
      <circle cx={18} cy={12} r={2} />
      <path d="M6 7.5v9" />
      <path d="M6 10c0 4 4 2 10 2" />
    </svg>
  );
}
function IconDollar({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden {...ip}>
      <path d="M12 4v16" />
      <path d="M16 8c-1.5-1.5-3-2-4-2-2 0-4 1-4 3s2 3 4 3 4 1 4 3-2 3-4 3c-1 0-2.5-.5-4-2" />
    </svg>
  );
}
function IconBolt({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden {...ip}>
      <path d="M13 3L5 14h6l-1 7 8-11h-6l1-7z" />
    </svg>
  );
}
function IconTarget({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden {...ip}>
      <circle cx={12} cy={12} r={8} />
      <circle cx={12} cy={12} r={4} />
      <circle cx={12} cy={12} r={1.2} fill="currentColor" stroke="none" />
    </svg>
  );
}
function IconWrench({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden {...ip}>
      <path d="M15.5 3a5 5 0 0 1 4.3 7.2l-12.6 12.6a1.8 1.8 0 0 1-2.6-2.6L17.2 7.6A5 5 0 0 1 15.5 3z" />
      <path d="M14 10l-1.2-1.2" />
    </svg>
  );
}
function IconPeers({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden {...ip}>
      <circle cx={8} cy={9} r={3} />
      <circle cx={16} cy={9} r={3} />
      <path d="M3 20c0-2.8 2.2-5 5-5s5 2.2 5 5" />
      <path d="M11 20c0-2.8 2.2-5 5-5s5 2.2 5 5" />
    </svg>
  );
}

// ── Data ────────────────────────────────────────────────────────────
type SourceKey = "claude" | "codex" | "cursor" | "github";
type Source = {
  key: SourceKey;
  label: string;
  tokens: string;
  unit: string;
  Mark: (p: { size?: number }) => ReactNode;
};
const SOURCES: Source[] = [
  {
    key: "claude",
    label: "Claude Code",
    tokens: "7.1M",
    unit: "TOK/DAY",
    Mark: ClaudeMark,
  },
  {
    key: "codex",
    label: "Codex",
    tokens: "4.25M",
    unit: "TOK/DAY",
    Mark: CodexMark,
  },
  {
    key: "cursor",
    label: "Cursor",
    tokens: "6.05M",
    unit: "TOK/DAY",
    Mark: CursorMark,
  },
  {
    key: "github",
    label: "GitHub",
    tokens: "312",
    unit: "PRS/MO",
    Mark: GithubMark,
  },
];

type Item = {
  label: string;
  value: string;
  Icon: (p: { size?: number }) => ReactNode;
};
type Group = { key: string; label: string; items: Item[] };
const GROUPS: Group[] = [
  {
    key: "delivery",
    label: "Delivery + Spend",
    items: [
      { label: "PRs Merged", value: "135", Icon: IconGitMerge },
      { label: "Cost / PR", value: "$32", Icon: IconDollar },
    ],
  },
  {
    key: "quality",
    label: "Session Quality",
    items: [
      { label: "Waste", value: "915M tok", Icon: IconBolt },
      { label: "Corrections", value: "15", Icon: IconTarget },
    ],
  },
  {
    key: "skills",
    label: "Skills + MCP",
    items: [
      { label: "Skill Output", value: "81%", Icon: IconWrench },
      { label: "MCP Tokens", value: "4.73M", Icon: IconPeers },
    ],
  },
];

// ── Slide-body geometry ─────────────────────────────────────────────
// All absolute-positioned children sit inside `.slide-body`, which in the
// 1920×1080 stage is 1728×824 (padding: 176 top / 96 sides / 80 bottom).
// Coordinates here are *slide-body-relative* — that's what top/left on
// children actually resolve against.
const SB_W = 1728;
const SB_H = 824;

const SRC_X = 24;
const SRC_W = 360;
const SRC_H = 100;
const SRC_GAP = 22;
const SRC_COL_H = SOURCES.length * SRC_H + (SOURCES.length - 1) * SRC_GAP; // 466

const GRP_W = 440;
const GRP_X = SB_W - 24 - GRP_W; // 1264
const GRP_H = 172;
const GRP_GAP = 20;
const GRP_COL_H = GROUPS.length * GRP_H + (GROUPS.length - 1) * GRP_GAP; // 556

const HUB_W = 260;
const HUB_H = 260;
const HUB_X = Math.round((SRC_X + SRC_W + GRP_X - HUB_W) / 2); // 694

// Shared content midline — slide-body is 824 tall, content centred on 412.
// Toggle is a small pill anchored at the top (y=0) and does not push the
// content down, so columns stay perfectly centred in the body.
const MID_Y = Math.round(SB_H / 2);
const SRC_Y0 = MID_Y - Math.round(SRC_COL_H / 2);
const GRP_Y0 = MID_Y - Math.round(GRP_COL_H / 2);
const HUB_Y = MID_Y - Math.round(HUB_H / 2);
const HUB_CY = MID_Y;

const sourceCenterY = (i: number) => SRC_Y0 + i * (SRC_H + SRC_GAP) + SRC_H / 2;
const groupCenterY = (i: number) => GRP_Y0 + i * (GRP_H + GRP_GAP) + GRP_H / 2;
const curvePath = (x1: number, y1: number, x2: number, y2: number) => {
  const mid = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`;
};

// Colours (by state)
const grayBorder = "rgba(237,232,222,0.1)";
const grayBg = "rgba(15,18,17,0.7)";
const grayFaint = "var(--ink-faint)";
const liveBorder = "rgba(110,138,111,0.42)";
const liveBg = "rgba(15,18,17,0.95)";

// ── Slide ────────────────────────────────────────────────────────────
export function Slide04BlackBox({ totalPages }: { totalPages: number }) {
  const [on, setOn] = useState(false);
  // Sweep key — bumps on each ON→transition so the one-shot CSS animation restarts.
  const [sweepTick, setSweepTick] = useState(0);
  const prevOn = useRef(on);

  useEffect(() => {
    if (on && !prevOn.current) setSweepTick((n) => n + 1);
    prevOn.current = on;
  }, [on]);

  const inPaths = useMemo(
    () =>
      SOURCES.map((_, i) =>
        curvePath(SRC_X + SRC_W, sourceCenterY(i), HUB_X, HUB_CY),
      ),
    [],
  );
  const outPaths = useMemo(
    () =>
      GROUPS.map((_, i) =>
        curvePath(HUB_X + HUB_W, HUB_CY, GRP_X, groupCenterY(i)),
      ),
    [],
  );

  return (
    <SlideShell
      sectionLabel="02 / THE PROBLEM"
      pageNumber={2}
      totalPages={totalPages}
    >
      {/* Toggle — large, wordless, centered below the black box */}
      <div
        style={{
          position: "absolute",
          top: MID_Y + HUB_H / 2 + 56,
          left: HUB_X + HUB_W / 2 - 66,
          width: 132,
          display: "flex",
          justifyContent: "center",
          zIndex: 5,
        }}
      >
        <button
          type="button"
          onClick={() => setOn((v) => !v)}
          aria-pressed={on}
          aria-label="Toggle telemetryc"
          style={{
            width: 132,
            height: 64,
            borderRadius: 999,
            border: `1.5px solid ${on ? "var(--accent)" : "var(--border)"}`,
            background: on ? "rgba(110,138,111,0.18)" : "transparent",
            padding: 0,
            position: "relative",
            cursor: "pointer",
            transition: "all .35s ease",
            boxShadow: on
              ? "0 0 0 6px rgba(110,138,111,0.08), 0 10px 30px -16px rgba(110,138,111,0.6)"
              : "none",
          }}
        >
          <span
            aria-hidden
            style={{
              position: "absolute",
              top: 6,
              left: on ? 132 - 6 - 52 : 6,
              width: 52,
              height: 52,
              borderRadius: "50%",
              background: on ? "var(--accent)" : "var(--ink-faint)",
              transition: "all .35s ease",
            }}
          />
        </button>
      </div>

      {/* Column headers */}
      <div
        style={{
          position: "absolute",
          left: SRC_X,
          top: SRC_Y0 - 36,
          width: SRC_W,
          fontFamily: "var(--f-mono)",
          fontSize: 12,
          color: grayFaint,
          textTransform: "uppercase",
          letterSpacing: "0.32em",
          zIndex: 3,
        }}
      >
        Source
      </div>
      <div
        style={{
          position: "absolute",
          left: GRP_X,
          top: GRP_Y0 - 36,
          width: GRP_W,
          textAlign: "right",
          fontFamily: "var(--f-mono)",
          fontSize: 12,
          color: grayFaint,
          textTransform: "uppercase",
          letterSpacing: "0.32em",
          zIndex: 3,
        }}
      >
        Outcome
      </div>

      {/* Connection SVG — lines + animated pulse dots */}
      <svg
        aria-hidden
        viewBox={`0 0 ${SB_W} ${SB_H}`}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          pointerEvents: "none",
          zIndex: 1,
        }}
      >
        <defs>
          <radialGradient id="bb-accent" cx="50%" cy="50%" r="65%">
            <stop offset="0%" stopColor="rgba(110,138,111,0.42)" />
            <stop offset="60%" stopColor="rgba(110,138,111,0.08)" />
            <stop offset="100%" stopColor="rgba(0,0,0,0)" />
          </radialGradient>
          {inPaths.map((d, i) => (
            <path key={`def-in-${i}`} id={`p-in-${i}`} d={d} />
          ))}
          {outPaths.map((d, i) => (
            <path key={`def-out-${i}`} id={`p-out-${i}`} d={d} />
          ))}
        </defs>

        {/* Hub halo — only visible ON */}
        <rect
          x={HUB_X - 140}
          y={HUB_Y - 140}
          width={HUB_W + 280}
          height={HUB_H + 280}
          fill="url(#bb-accent)"
          style={{ opacity: on ? 1 : 0, transition: "opacity .8s ease" }}
        />

        {/* Connection lines — gray in both states, slightly greener when ON */}
        {inPaths.map((d, i) => (
          <path
            key={`in-line-${i}`}
            d={d}
            fill="none"
            stroke={on ? "rgba(110,138,111,0.35)" : grayBorder}
            strokeWidth={1.2}
            style={{ transition: "stroke .5s ease" }}
          />
        ))}
        {outPaths.map((d, i) => (
          <path
            key={`out-line-${i}`}
            d={d}
            fill="none"
            stroke={on ? "rgba(110,138,111,0.35)" : grayBorder}
            strokeWidth={1.2}
            strokeDasharray={on ? "0" : "4 8"}
            style={{ transition: "stroke .5s ease" }}
          />
        ))}

        {/* Pulse dots —
            ON  : green, fast, flow across the whole diagram (sources → hub → outcomes)
            OFF : orange, slow, only on inPaths, fade out as they hit the black box */}
        {on
          ? [
              ...inPaths.map((_, i) => ({ id: `p-in-${i}`, offset: i * 0.22 })),
              ...outPaths.map((_, i) => ({
                id: `p-out-${i}`,
                offset: 0.7 + i * 0.22,
              })),
            ].flatMap(({ id, offset }, k) =>
              [0, 1.1, 2.2].map((stagger, j) => {
                const beginAt = `${(offset + stagger).toFixed(2)}s`;
                return (
                  <circle
                    key={`pulse-${k}-${j}`}
                    r={3.2}
                    fill="var(--accent)"
                    opacity={0}
                    style={{
                      filter: "drop-shadow(0 0 6px rgba(110,138,111,0.9))",
                    }}
                  >
                    <animateMotion
                      dur="3.3s"
                      repeatCount="indefinite"
                      begin={beginAt}
                      rotate="auto"
                    >
                      <mpath href={`#${id}`} />
                    </animateMotion>
                    {/* Flip to opaque when the motion fires so the dot
                        doesn't render at the SVG origin (0,0) during the
                        pre-begin delay — that was the stray orange dot. */}
                    <animate
                      attributeName="opacity"
                      from="0"
                      to="1"
                      dur="0.01s"
                      begin={beginAt}
                      fill="freeze"
                    />
                  </circle>
                );
              }),
            )
          : inPaths.flatMap((_, i) =>
              [0, 2.75].map((stagger, j) => (
                <circle
                  key={`dead-${i}-${j}`}
                  r={2.8}
                  fill="#b07b3e"
                  opacity={0}
                  style={{
                    filter: "drop-shadow(0 0 5px rgba(176,123,62,0.85))",
                  }}
                >
                  <animateMotion
                    dur="5.5s"
                    repeatCount="indefinite"
                    begin={`${(i * 0.4 + stagger).toFixed(2)}s`}
                    rotate="auto"
                  >
                    <mpath href={`#p-in-${i}`} />
                  </animateMotion>
                  <animate
                    attributeName="opacity"
                    values="0;1;1;0"
                    keyTimes="0;0.15;0.85;1"
                    dur="5.5s"
                    repeatCount="indefinite"
                    begin={`${(i * 0.4 + stagger).toFixed(2)}s`}
                  />
                </circle>
              )),
            )}
      </svg>

      {/* One-shot scan sweep — re-mounts on each OFF→ON flip via `key` */}
      {on ? (
        <div
          key={`sweep-${sweepTick}`}
          aria-hidden
          className="deck-bb-sweep"
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            zIndex: 4,
          }}
        />
      ) : null}

      {/* ── Source cards (always live — they represent real data on every
          dev's machine; the problem isn't the sources, it's that outcomes
          can't be unlocked without pellametric) ───────────────────────── */}
      {SOURCES.map((s, i) => {
        const Mark = s.Mark;
        return (
          <div
            key={s.key}
            style={{
              position: "absolute",
              left: SRC_X,
              top: SRC_Y0 + i * (SRC_H + SRC_GAP),
              width: SRC_W,
              height: SRC_H,
              border: `1px solid ${liveBorder}`,
              background: liveBg,
              borderRadius: 14,
              padding: "0 26px",
              display: "grid",
              gridTemplateColumns: "auto 1fr auto",
              alignItems: "center",
              columnGap: 18,
              zIndex: 2,
              boxShadow: "0 16px 40px -28px rgba(0,0,0,0.85)",
            }}
          >
            <span style={{ display: "inline-flex", alignItems: "center" }}>
              <Mark size={32} />
            </span>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 4,
                minWidth: 0,
              }}
            >
              <span
                style={{
                  fontFamily: "var(--f-mono)",
                  fontSize: 11,
                  color: grayFaint,
                  textTransform: "uppercase",
                  letterSpacing: "0.22em",
                }}
              >
                Source
              </span>
              <span
                style={{
                  fontFamily: "var(--f-head)",
                  fontSize: 28,
                  color: "var(--ink)",
                  letterSpacing: "-0.015em",
                  fontWeight: 500,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  lineHeight: 1,
                }}
              >
                {s.label}
              </span>
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-end",
                gap: 4,
              }}
            >
              <span
                style={{
                  fontFamily: "var(--f-sys)",
                  fontSize: 22,
                  color: "var(--accent)",
                  lineHeight: 1,
                }}
              >
                {s.tokens}
              </span>
              <span
                style={{
                  fontFamily: "var(--f-mono)",
                  fontSize: 10,
                  color: grayFaint,
                  textTransform: "uppercase",
                  letterSpacing: "0.22em",
                }}
              >
                {s.unit}
              </span>
            </div>
          </div>
        );
      })}

      {/* ── Hub ──────────────────────────────────────────────────── */}
      <button
        type="button"
        onClick={() => setOn((v) => !v)}
        aria-pressed={on}
        aria-label="Toggle telemetryc"
        style={{
          position: "absolute",
          left: HUB_X,
          top: HUB_Y,
          width: HUB_W,
          height: HUB_H,
          borderRadius: 22,
          background:
            "linear-gradient(160deg, rgba(10,12,13,0.98), rgba(4,5,6,0.98))",
          border: `1.5px solid ${on ? "rgba(110,138,111,0.65)" : "rgba(237,232,222,0.14)"}`,
          padding: 0,
          cursor: "pointer",
          zIndex: 3,
          color: "inherit",
          boxShadow: on
            ? "inset 0 1px 0 rgba(255,255,255,0.05), 0 30px 80px -20px rgba(110,138,111,0.45)"
            : "inset 0 1px 0 rgba(255,255,255,0.03), 0 30px 70px -30px rgba(0,0,0,0.9)",
          transition: "all .5s ease",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
        }}
      >
        {on ? (
          <span
            aria-hidden
            className="deck-bb-ring"
            style={{
              position: "absolute",
              inset: 28,
              borderRadius: "50%",
              border: "1px dashed rgba(110,138,111,0.4)",
            }}
          />
        ) : null}

        <img
          key={on ? `on-${sweepTick}` : "off"}
          src="/primary-logo.svg"
          alt=""
          aria-hidden
          className={`deck-bb-logo${on ? " is-on" : ""}`}
          style={{ position: "relative" }}
        />
      </button>

      {/* ── Outcome groups ───────────────────────────────────────── */}
      {GROUPS.map((g, i) => (
        <div
          key={g.key}
          style={{
            position: "absolute",
            left: GRP_X,
            top: GRP_Y0 + i * (GRP_H + GRP_GAP),
            width: GRP_W,
            height: GRP_H,
            border: `1px solid ${on ? liveBorder : grayBorder}`,
            background: on ? liveBg : grayBg,
            borderRadius: 14,
            padding: "20px 26px",
            display: "flex",
            flexDirection: "column",
            gap: 12,
            zIndex: 2,
            boxShadow: on ? "0 20px 48px -28px rgba(110,138,111,0.4)" : "none",
            transition:
              "border-color .5s ease, background .5s ease, box-shadow .5s ease",
            transitionDelay: on ? `${0.35 + i * 0.08}s` : "0s",
          }}
        >
          <div
            style={{
              fontFamily: "var(--f-mono)",
              fontSize: 12,
              color: grayFaint,
              textTransform: "uppercase",
              letterSpacing: "0.28em",
            }}
          >
            {g.label}
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              flex: 1,
              justifyContent: "center",
            }}
          >
            {g.items.map((item, idx) => {
              const ItemIcon = item.Icon;
              return (
                <div
                  key={item.label}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "24px 1fr auto",
                    alignItems: "center",
                    columnGap: 14,
                    padding: "10px 0",
                    borderBottom:
                      idx < g.items.length - 1
                        ? "1px dashed rgba(237,232,222,0.08)"
                        : "none",
                  }}
                >
                  <span
                    aria-hidden
                    style={{
                      color: on ? "var(--accent)" : grayFaint,
                      transition: "color .5s",
                      transitionDelay: on ? `${0.4 + i * 0.08}s` : "0s",
                      display: "inline-flex",
                    }}
                  >
                    <ItemIcon size={20} />
                  </span>
                  <span
                    style={{
                      fontFamily: "var(--f-head)",
                      fontSize: 22,
                      color: on ? "var(--ink)" : grayFaint,
                      letterSpacing: "-0.01em",
                      fontWeight: 400,
                      transition: "color .5s",
                      transitionDelay: on ? `${0.4 + i * 0.08}s` : "0s",
                    }}
                  >
                    {item.label}
                  </span>
                  <span
                    style={{
                      fontFamily: "var(--f-sys)",
                      fontSize: 22,
                      color: on ? "var(--accent)" : grayFaint,
                      opacity: on ? 1 : 0.7,
                      transition: "color .5s, opacity .5s",
                      transitionDelay: on ? `${0.45 + i * 0.08}s` : "0s",
                    }}
                  >
                    {on ? item.value : "—"}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </SlideShell>
  );
}
