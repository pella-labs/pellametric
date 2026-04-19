"use client";

import { motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { DEMO_CARD } from "../../(marketing)/_card/demo-data";

/**
 * Investor-deck DeveloperCard — a richer, motion-forward presentation of
 * the per-engineer artifact. Reads real shape from `DEMO_CARD` (the same
 * fixture the landing page uses) so the numbers stay in sync between the
 * two surfaces. Animated on slide entry:
 *   - tokens counter rolls up from 0 to the real demo value
 *   - streak cells reveal left-to-right
 *   - KPIs crossfade in sequence
 */
export function DeveloperCard({ active }: { active: boolean }) {
  const reduce = useReducedMotion();

  const highlights = DEMO_CARD.stats.highlights;
  const user = DEMO_CARD.user;
  const totalTokens =
    DEMO_CARD.stats.combined.totalInputTokens + DEMO_CARD.stats.combined.totalOutputTokens;
  const longestStreak = highlights?.longestStreak ?? 0;
  const totalCost = DEMO_CARD.stats.combined.totalCost;
  const totalSessions = DEMO_CARD.stats.combined.totalSessions;
  const peakHour = highlights?.peakHourLabel ?? "—";
  const favoriteModel = highlights?.favoriteModel ?? "claude";
  const favoriteTool = highlights?.favoriteTool ?? "Edit";
  const activityCategories = highlights?.activityCategories ?? [];

  // Last 56 daily cells for the streak heatmap (8 rows × 7 cols).
  const lastCells = DEMO_CARD.stats.combined.dailyDistribution?.slice(-56) ?? [];

  return (
    <div
      style={{
        width: 580,
        border: "1px solid var(--border)",
        background:
          "linear-gradient(155deg, rgba(110,138,111,0.10), transparent 55%), var(--bg-elev)",
        padding: "32px 36px 28px",
        display: "flex",
        flexDirection: "column",
        gap: 20,
        position: "relative",
        overflow: "hidden",
        boxShadow: "0 40px 80px rgba(0,0,0,0.55)",
      }}
    >
      {/* Soft accent glow bg */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(60% 50% at 15% 10%, rgba(110,138,111,0.18), transparent 60%), radial-gradient(50% 40% at 90% 95%, rgba(176,123,62,0.12), transparent 60%)",
          pointerEvents: "none",
          zIndex: 0,
        }}
      />
      <div style={{ position: "relative", zIndex: 1, display: "contents" }}>
        {/* Header */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            borderBottom: "1px solid var(--border)",
            paddingBottom: 20,
          }}
        >
          <div>
            <div className="sys" style={{ fontSize: 14, marginBottom: 8 }}>
              Engineer · Last 30d
            </div>
            <div
              style={{
                fontFamily: "var(--f-head)",
                fontSize: 30,
                color: "var(--ink)",
                letterSpacing: "-0.02em",
              }}
            >
              {user?.displayName ?? "Demo Developer"}
            </div>
            <div
              style={{
                fontFamily: "var(--f-mono)",
                fontSize: 14,
                color: "var(--ink-muted)",
                marginTop: 2,
              }}
            >
              @{user?.githubUsername ?? "demo-dev"} · {highlights?.personality ?? "Power User"}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
            <span className="badge accent" style={{ fontSize: 13 }}>
              LVL 5
            </span>
            <span className="badge" style={{ fontSize: 13 }}>
              POWER USER
            </span>
          </div>
        </div>

        {/* Tokens counter */}
        <div>
          <div className="sys" style={{ fontSize: 13, marginBottom: 4 }}>
            Tokens generated
          </div>
          <TokenCounter
            target={totalTokens}
            active={active}
            reduce={reduce ?? false}
            className="mono"
          />
          <div
            style={{
              fontFamily: "var(--f-mono)",
              fontSize: 13,
              color: "var(--ink-muted)",
              marginTop: 4,
            }}
          >
            ${totalCost.toFixed(2)} spend · {totalSessions.toLocaleString()} sessions
          </div>
        </div>

        {/* Streak heatmap */}
        <div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              marginBottom: 10,
            }}
          >
            <span className="sys" style={{ fontSize: 13 }}>
              Streak · last 56 days
            </span>
            <span
              style={{
                fontFamily: "var(--f-mono)",
                fontSize: 14,
                color: "var(--accent)",
              }}
            >
              {longestStreak}-day streak
            </span>
          </div>
          <StreakHeatmap cells={lastCells} active={active} reduce={reduce ?? false} />
        </div>

        {/* Activity breakdown */}
        <div>
          <div className="sys" style={{ fontSize: 13, marginBottom: 10 }}>
            How the work breaks down
          </div>
          <div
            style={{
              display: "flex",
              height: 10,
              borderRadius: 2,
              overflow: "hidden",
              background: "var(--bg)",
              border: "1px solid var(--border)",
            }}
          >
            {activityCategories.map((c, i) => (
              <motion.div
                key={c.category}
                initial={reduce ? false : { width: 0 }}
                animate={{ width: active ? `${c.sessionPct}%` : reduce ? `${c.sessionPct}%` : 0 }}
                transition={{ duration: reduce ? 0 : 0.6, delay: reduce ? 0 : 0.2 + i * 0.08 }}
                style={{
                  background: CATEGORY_COLORS[i % CATEGORY_COLORS.length],
                  height: "100%",
                }}
              />
            ))}
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: 8,
              marginTop: 10,
              fontFamily: "var(--f-mono)",
              fontSize: 12,
              color: "var(--ink-muted)",
            }}
          >
            {activityCategories.slice(0, 3).map((c, i) => (
              <div key={c.category} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span
                  style={{
                    width: 8,
                    height: 8,
                    background: CATEGORY_COLORS[i % CATEGORY_COLORS.length],
                  }}
                />
                <span>
                  {c.category.toLowerCase()} {c.sessionPct}%
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Footer stats */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 16,
            paddingTop: 16,
            borderTop: "1px solid var(--border)",
          }}
        >
          <Stat label="Peak hour" value={peakHour} />
          <Stat
            label="Top model"
            value={favoriteModel.replace("claude-", "").split("-")[0] ?? favoriteModel}
          />
          <Stat label="Top tool" value={favoriteTool} />
        </div>
      </div>
    </div>
  );
}

const CATEGORY_COLORS = [
  "#6e8a6f", // accent — building
  "#8fa890", // lighter accent — investigating
  "#b07b3e", // warm — debugging
  "#d8b379", // warm muted — testing
  "#5c6370", // ink-faint — refactoring
  "rgba(237,232,222,0.2)", // other
];

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="sys" style={{ fontSize: 11, marginBottom: 2, letterSpacing: "0.14em" }}>
        {label}
      </div>
      <div
        style={{
          fontFamily: "var(--f-mono)",
          fontSize: 16,
          color: "var(--ink)",
          textTransform: "lowercase",
        }}
      >
        {value}
      </div>
    </div>
  );
}

function TokenCounter({
  target,
  active,
  reduce,
  className,
}: {
  target: number;
  active: boolean;
  reduce: boolean;
  className?: string;
}) {
  const [value, setValue] = useState(reduce ? target : 0);
  const startedRef = useRef(false);

  useEffect(() => {
    if (!active || reduce) return;
    if (startedRef.current) return;
    startedRef.current = true;
    setValue(0);
    const duration = 1400;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      // easeOutQuint for a satisfying roll-up
      const eased = 1 - (1 - t) ** 5;
      setValue(Math.round(eased * target));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, reduce, target]);

  return (
    <div
      className={className}
      style={{
        fontFamily: "var(--f-sys)",
        fontSize: 56,
        color: "var(--ink)",
        letterSpacing: "-0.03em",
        lineHeight: 1,
      }}
    >
      {formatTokens(value)}
    </div>
  );
}

function formatTokens(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function StreakHeatmap({
  cells,
  active,
  reduce,
}: {
  cells: Array<{ sessions: number }>;
  active: boolean;
  reduce: boolean;
}) {
  const cols = 14;
  const rows = 4;
  const need = cols * rows;
  const padded =
    cells.length >= need
      ? cells.slice(-need)
      : Array(need - cells.length)
          .fill({ sessions: 0 })
          .concat(cells);
  const max = Math.max(1, ...padded.map((c) => c.sessions));

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${cols}, 1fr)`,
        gridTemplateRows: `repeat(${rows}, 1fr)`,
        gap: 4,
        height: 100,
      }}
    >
      {padded.map((c, i) => {
        const intensity = c.sessions / max;
        const bg =
          intensity === 0
            ? "rgba(237,232,222,0.05)"
            : `rgba(110,138,111,${0.18 + intensity * 0.82})`;
        return (
          <motion.div
            key={i}
            initial={reduce ? false : { opacity: 0, scale: 0.6 }}
            animate={{ opacity: active ? 1 : reduce ? 1 : 0, scale: active ? 1 : reduce ? 1 : 0.6 }}
            transition={{
              duration: reduce ? 0 : 0.3,
              delay: reduce ? 0 : 0.4 + (i / padded.length) * 0.8,
            }}
            style={{ background: bg, borderRadius: 1 }}
            title={`${c.sessions} sessions`}
          />
        );
      })}
    </div>
  );
}
