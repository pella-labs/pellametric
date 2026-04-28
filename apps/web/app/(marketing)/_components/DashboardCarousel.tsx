"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const SLIDES = [
  {
    src: "/dash-overview.png",
    url: "metrics.yourteam.internal / dashboard",
    alt: "Per-engineer Pellametric dashboard with active hours, daily output, intent mix, and tools/skills/models breakdowns.",
  },
  {
    src: "/dash-engineer.png",
    url: "metrics.yourteam.internal / team-snapshot/alejandro",
    alt: "Engineer detail view with profile photo, KPI strip, holographic Pellametric card, and top-repo / skill / MCP / tool panels.",
  },
  {
    src: "/dash-team.png",
    url: "metrics.yourteam.internal / team-snapshot",
    alt: "Team manager view with delivery + spend table, skills usage, and MCP usage per dev.",
  },
] as const;

const ROTATE_MS = 6000;

export function DashboardCarousel() {
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const go = useCallback((next: number) => {
    setI(((next % SLIDES.length) + SLIDES.length) % SLIDES.length);
  }, []);

  useEffect(() => {
    if (paused) return;
    const id = setInterval(() => setI(prev => (prev + 1) % SLIDES.length), ROTATE_MS);
    return () => clearInterval(id);
  }, [paused]);

  // Pause when off-screen — saves CPU and avoids surprising background advance.
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      ([entry]) => setPaused(p => (entry.isIntersecting ? false : true)),
      { threshold: 0.1 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <section className="mk-dashboard-shot">
      <div style={{ textAlign: "center", maxWidth: 640 }}>
        <span className="mk-sys" style={{ display: "block", marginBottom: 12 }}>
          The instrument
        </span>
        <h2
          className="mk-mono"
          style={{ fontSize: "clamp(24px, 3vw, 36px)", letterSpacing: "-0.02em" }}
        >
          One surface for the whole stack.
        </h2>
        <p style={{ color: "var(--mk-ink-muted)", fontSize: 15, marginTop: 12, lineHeight: 1.55 }}>
          What your agents cost, what they shipped, and which prompts actually ship code. Built for
          engineering leaders handed an AI bill, a pile of session logs, and asked to make sense of
          both.
        </p>
      </div>

      <div
        className="mk-dashboard-shot-frame mk-carousel"
        ref={ref}
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
      >
        <div className="mk-dashboard-shot-chrome">
          <span style={{ background: "#ff5f57" }} />
          <span style={{ background: "#febc2e" }} />
          <span style={{ background: "#28c840" }} />
          <span className="dot-url" key={SLIDES[i].url}>
            {SLIDES[i].url}
          </span>
        </div>

        <div className="mk-carousel-stage">
          {SLIDES.map((s, idx) => (
            <img
              key={s.src}
              src={s.src}
              alt={s.alt}
              className={`mk-carousel-slide ${idx === i ? "is-active" : ""}`}
              loading={idx === 0 ? "eager" : "lazy"}
              decoding="async"
            />
          ))}

          <button
            type="button"
            className="mk-carousel-arrow mk-carousel-arrow-prev"
            aria-label="Previous slide"
            onClick={() => go(i - 1)}
          >
            ‹
          </button>
          <button
            type="button"
            className="mk-carousel-arrow mk-carousel-arrow-next"
            aria-label="Next slide"
            onClick={() => go(i + 1)}
          >
            ›
          </button>
        </div>

        <div className="mk-carousel-dots" role="tablist" aria-label="Dashboard views">
          {SLIDES.map((s, idx) => (
            <button
              key={s.src}
              type="button"
              role="tab"
              aria-selected={idx === i}
              aria-label={`Go to slide ${idx + 1}`}
              className={`mk-carousel-dot ${idx === i ? "is-active" : ""}`}
              onClick={() => go(idx)}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
