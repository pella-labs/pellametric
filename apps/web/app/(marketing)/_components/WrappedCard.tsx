"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import {
  type CardData,
  formatCost,
  formatTokens,
  getPersonality,
  getTier,
} from "../_card/card-utils";

/**
 * Condensed hero card: a single static front with the top 5 stats from a
 * full CardPage, plus a "View your card" CTA into /demo. Used on the landing
 * hero, driven by demo data.
 */
export function WrappedCard({ data }: { data: CardData }) {
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const mx = ((e.clientX - r.left) / r.width) * 100;
      const my = ((e.clientY - r.top) / r.height) * 100;
      el.style.setProperty("--mx", `${mx}%`);
      el.style.setProperty("--my", `${my}%`);
      const tiltX = (my - 50) * -0.06;
      const tiltY = (mx - 50) * 0.08;
      el.style.setProperty("--tx", `${tiltY}deg`);
      el.style.setProperty("--ty", `${tiltX}deg`);
    };
    const onLeave = () => {
      el.style.setProperty("--tx", "0deg");
      el.style.setProperty("--ty", "0deg");
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", onLeave);
    return () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  const personality = data.stats.highlights?.personality
    ? { name: data.stats.highlights.personality, desc: "" }
    : getPersonality(data.stats.claude.hourDistribution);

  const tier = getTier(data.stats.combined.totalSessions);
  const totalTokens = data.stats.combined.totalInputTokens + data.stats.combined.totalOutputTokens;

  return (
    <div className="wrapped-card-wrap">
      <div ref={rootRef} className="wrapped-card" role="img" aria-label="Sample shareable card">
        <div className="wrapped-card-shine" aria-hidden />
        <div className="wrapped-card-inner">
          <div className="wrapped-card-top">
            <span className="wrapped-card-brand">BEMATIST</span>
            <span className="wrapped-card-tier">{tier}</span>
          </div>

          <div className="wrapped-card-hero">
            <div className="wrapped-card-label">Personality</div>
            <div className="wrapped-card-title">{personality.name}</div>
            <div className="wrapped-card-sub">
              Peak hour <strong>{data.stats.highlights?.peakHourLabel ?? "3 PM"}</strong> ·{" "}
              {data.stats.combined.totalActiveDays ?? data.stats.claude.activeDays} active days
            </div>
          </div>

          <div className="wrapped-card-grid">
            <Stat label="Total spend" value={formatCost(data.stats.combined.totalCost)} />
            <Stat label="Sessions" value={data.stats.combined.totalSessions.toLocaleString()} />
            <Stat label="Tokens" value={formatTokens(totalTokens)} />
            <Stat label="Cache saved" value={formatCost(data.stats.claude.cacheSavingsUsd)} />
          </div>

          <div className="wrapped-card-bars" aria-hidden>
            {data.stats.claude.hourDistribution.map((v, i) => {
              const max = Math.max(...data.stats.claude.hourDistribution, 1);
              const h = 4 + (v / max) * 36;
              return (
                <span
                  key={`hour-${i}-${v}`}
                  style={{ height: `${h}px` }}
                  className="wrapped-card-bar"
                />
              );
            })}
          </div>

          <div className="wrapped-card-foot">
            <span>
              @{data.user?.githubUsername ?? "demo-dev"} · {data.user?.displayName ?? "Demo"}
            </span>
            <Link href="/demo" className="wrapped-card-link">
              See full card →
            </Link>
          </div>
        </div>
      </div>
      <div className="wrapped-card-caption">
        <span className="mk-sys">Live sample</span>
        <p>
          Every bematist user gets a private card summarizing their coding-agent activity. Share it,
          keep it, burn after reading.
        </p>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="wrapped-stat">
      <div className="wrapped-stat-label">{label}</div>
      <div className="wrapped-stat-value">{value}</div>
    </div>
  );
}
