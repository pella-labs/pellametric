"use client";

import { PMonogram } from "../../(marketing)/_components/Monogram";

export function Slide01Cover(_props: { totalPages: number }) {
  return (
    <div className="cover">
      <div className="cover-left">
        <h1 className="cover-wordmark">Pellametric</h1>
        <p
          className="lede"
          style={{
            maxWidth: 820,
            fontSize: 40,
            lineHeight: 1.15,
            margin: 0,
            fontWeight: 500,
          }}
        >
          Telemetry for{" "}
          <em className="accent">AI-augmented engineering teams</em>.
        </p>
        <p
          style={{
            maxWidth: 820,
            fontSize: 30,
            lineHeight: 1.4,
            color: "var(--ink-muted)",
            margin: "18px 0 0 0",
          }}
        >
          <span style={{ color: "var(--ink)" }}>Every prompt.</span>{" "}
          <span style={{ color: "var(--ink)" }}>Every PR.</span>{" "}
          <span style={{ color: "var(--ink)" }}>Every dollar.</span>
        </p>
      </div>

      <div className="cover-right">
        <div className="cover-monogram" aria-hidden>
          <svg className="ring-text" viewBox="0 0 420 420" role="presentation">
            <title>Pellametric wordring</title>
            <defs>
              <path
                id="roadmap-cover-ring-path"
                d="M 210,210 m -192,0 a 192,192 0 1,1 384,0 a 192,192 0 1,1 -384,0"
              />
            </defs>
            <text>
              <textPath href="#roadmap-cover-ring-path" startOffset="0%">
                {"ROADMAP · VISION · 2026 · AI ENGINEERING TELEMETRY · $/PR · ACCEPTED EDITS · ".repeat(
                  2,
                )}
              </textPath>
            </text>
          </svg>
          <div className="logo-host">
            <PMonogram
              color="#6e8a6f"
              attenuationColor="#0f1a10"
              rimColor="#b07b3e"
              keyColor="#eaf3e5"
              backColor="#6e8a6f"
              interactive={false}
              autoRotate
              autoRotateSpeed={0.009}
              float
            />
          </div>
        </div>
      </div>

      <div className="cover-bottom">
        <div>
          <div className="label">Document</div>
          <div className="val">Roadmap & Vision · May 2026</div>
        </div>
        <div>
          <div className="label">Web</div>
          <div className="val">pellametric.com</div>
        </div>
        <div>
          <div className="label">Contact</div>
          <div
            className="val"
            style={{ display: "inline-flex", alignItems: "center", gap: 10 }}
          >
            <XGlyph />
            <span>@pellametric</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function XGlyph() {
  return (
    <span
      aria-hidden
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: "1.5em",
        height: "1.5em",
        borderRadius: "6px",
        background: "var(--ink)",
        color: "var(--bg)",
        flexShrink: 0,
      }}
    >
      <svg
        viewBox="0 0 24 24"
        fill="currentColor"
        role="img"
        style={{ width: "0.78em", height: "0.78em" }}
      >
        <title>X</title>
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
      </svg>
    </span>
  );
}
