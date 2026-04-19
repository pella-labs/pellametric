"use client";

import { BMonogram } from "../../(marketing)/_components/Monogram";

/**
 * Slide 1 — Cover / title.
 * Two-column layout: eyebrow + "Bematist." + descriptor on the left,
 * 3D rotating B-mark inside an orbiting wordring on the right. Reuses the
 * landing-page BMonogram component (three.js).
 */
export function Slide01Cover({ totalPages }: { totalPages: number }) {
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
            maxWidth: 780,
            fontSize: 34,
            margin: 0,
          }}
        >
          The instrument for <em className="accent">AI-assisted engineering</em>. See where every
          dollar lands, which workflows ship code, and the patterns worth copying across your team.
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
            Walid Khori · David Alhe · Sebastian Garces · Jorge Alejandro Diaz · Sandesh Pathak
          </div>
        </div>
        <div>
          <div className="label">Web</div>
          <div className="val">bematist.dev</div>
        </div>
        <div>
          <div className="label">Contact</div>
          <div className="val">hello@bematist.dev</div>
        </div>
      </div>
      <div className="pagenum-left">bematist.dev</div>
      <div className="pagenum">
        01 <span className="total">/ {String(totalPages).padStart(2, "0")}</span>
      </div>
    </div>
  );
}
