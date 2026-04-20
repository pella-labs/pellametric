"use client";

import { BMonogram } from "../../(marketing)/_components/Monogram";

/**
 * Slide 1 — Cover / title.
 * Two-column layout: eyebrow + "Bematist." + descriptor on the left,
 * 3D rotating B-mark inside an orbiting wordring on the right. Reuses the
 * landing-page BMonogram component (three.js).
 */
export function Slide01Cover(_props: { totalPages: number }) {
  return (
    <div className="cover">
      <div className="cover-top">
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 14,
            fontFamily: "var(--f-sys)",
            fontWeight: 700,
            color: "var(--ink)",
            fontSize: 26,
            letterSpacing: "-0.02em",
            textTransform: "none",
          }}
        >
          <span
            style={{
              width: 14,
              height: 14,
              background: "var(--accent)",
              display: "inline-block",
            }}
          />
          <span>bematist</span>
        </div>
        <div>Pella Labs · 2026</div>
      </div>

      <div className="cover-left">
        <div className="sys" style={{ fontSize: 22, letterSpacing: "0.2em", marginBottom: 4 }}>
          OPEN-SOURCE · SELF-HOSTABLE
        </div>
        <h1 className="cover-wordmark">Bematist.</h1>
        <p
          className="lede"
          style={{
            maxWidth: 820,
            fontSize: 38,
            lineHeight: 1.15,
            margin: 0,
            fontWeight: 500,
          }}
        >
          Measure <em className="accent">AI-assisted engineering</em>.
        </p>
        <p
          style={{
            maxWidth: 820,
            fontSize: 26,
            lineHeight: 1.4,
            color: "var(--ink-muted)",
            margin: "18px 0 0 0",
          }}
        >
          <span style={{ color: "var(--ink)" }}>See the spend.</span>{" "}
          <span style={{ color: "var(--ink)" }}>See the work.</span>{" "}
          <span style={{ color: "var(--ink)" }}>Scale what ships.</span>
        </p>
      </div>

      <div className="cover-right">
        <div className="cover-monogram" aria-hidden>
          <svg className="ring-text" viewBox="0 0 420 420" role="presentation">
            <title>Bematist wordring</title>
            <defs>
              <path
                id="deck-cover-ring-path"
                d="M 210,210 m -192,0 a 192,192 0 1,1 384,0 a 192,192 0 1,1 -384,0"
              />
            </defs>
            <text>
              <textPath href="#deck-cover-ring-path" startOffset="0%">
                BEMATIST · AI ENGINEERING TELEMETRY · $/PR · ACCEPTED EDITS · AI SPEND · OUTCOMES ·
                CLUSTERS ·{" "}
              </textPath>
            </text>
          </svg>
          <div className="logo-host">
            <BMonogram
              color="#6e8a6f"
              attenuationColor="#0f1a10"
              rimColor="#b07b3e"
              keyColor="#eaf3e5"
              backColor="#6e8a6f"
              interactive={false}
              autoRotate
              autoRotateSpeed={0.005}
              float
            />
          </div>
        </div>
      </div>

      <div className="cover-bottom">
        <div>
          <div className="label">Presented by</div>
          <div className="val">
            Walid Khori · David Aihe · Sebastian Garces
            <br />
            Jorge Alejandro Diez · Sandesh Pathak
          </div>
        </div>
        <div>
          <div className="label">Web</div>
          <div className="val">bematist.dev</div>
        </div>
        <div>
          <div className="label">Contact</div>
          <div className="val" style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
            <XGlyph />
            <span>@bematist_dev</span>
          </div>
        </div>
      </div>
      <div className="pagenum-left">bematist.dev</div>
    </div>
  );
}

/**
 * Inline X (formerly Twitter) glyph. Official mark path, sized to match
 * the surrounding footer type.
 */
/**
 * X (formerly Twitter) brand mark rendered as a filled chip — matches how
 * X presents its own social button so the glyph reads as a *logo* next to
 * the handle, not as a thin letter X. Sized in ems so it scales with the
 * surrounding footer type at any slide zoom.
 */
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
