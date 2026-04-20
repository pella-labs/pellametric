"use client";

import Image from "next/image";
import { CardMount } from "../../(marketing)/_card/CardMount";
import { DEMO_CARD } from "../../(marketing)/_card/demo-data";

/**
 * Final slide — company-facing value prop on the LEFT (pitch summary +
 * shrunk QR), live shareable card on the RIGHT auto-advancing through
 * all 8 card pages so the audience sees every face without keyboard
 * input. One frame, two readers.
 */
export function Slide14Cta(_props: { totalPages: number }) {
  return (
    <div
      className="slide"
      style={{ padding: 0, height: "100%", position: "relative", overflow: "hidden" }}
    >
      <div className="grid-bg" />

      <div className="chrome-row">
        <div className="wordmark">
          <span className="wordmark-dot" /> bematist
        </div>
        <div className="chrome-right">13 / CLOSING</div>
      </div>

      <div
        className="cta"
        style={{
          position: "relative",
          zIndex: 2,
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 80,
          alignItems: "center",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-start",
            gap: 28,
          }}
        >
          <div className="eyebrow">FOR THE COMPANY</div>
          <h2 className="title" style={{ fontSize: 64, lineHeight: 1.05, margin: 0 }}>
            See the leverage behind every <em>dollar</em>.
          </h2>
          <p className="body-text" style={{ margin: 0, fontSize: 22 }}>
            Bematist auto-instruments every coding agent on the team and ties AI spend to what
            actually ships — accepted edits, merged PRs, green tests.
          </p>
          <ul className="reader-list" style={{ margin: 0 }}>
            <li>
              <span className="ink" style={{ fontWeight: 500 }}>
                Spend allocation.
              </span>{" "}
              <span className="muted">Where the AI budget goes, by engineer and repo.</span>
            </li>
            <li>
              <span className="ink" style={{ fontWeight: 500 }}>
                Outcome attribution.
              </span>{" "}
              <span className="muted">$ per accepted edit, $ per merged PR.</span>
            </li>
            <li>
              <span className="ink" style={{ fontWeight: 500 }}>
                Efficiency drivers.
              </span>{" "}
              <span className="muted">Why one engineer ships 10× the leverage per dollar.</span>
            </li>
          </ul>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <span className="badge accent">OPEN SOURCE</span>
            <span className="badge warm">SELF-HOSTABLE</span>
            <span className="badge accent">APACHE 2.0</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 20, marginTop: 4 }}>
            <div
              style={{
                width: 160,
                height: 160,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                position: "relative",
                borderRadius: 20,
                overflow: "hidden",
                background: "#fff",
                padding: 10,
                boxSizing: "border-box",
                filter: "drop-shadow(0 16px 32px rgba(110,138,111,0.3))",
                flexShrink: 0,
              }}
            >
              <Image
                src="/deck/qr-bematist.png"
                alt="QR code — bematist.dev"
                width={140}
                height={140}
                priority
                style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
              />
            </div>
            <div
              className="sys"
              style={{ fontSize: 14, letterSpacing: "0.22em", lineHeight: 1.5 }}
            >
              SCAN TO INSTALL
              <br />→ BEMATIST.DEV
            </div>
          </div>
        </div>

        <div
          style={{
            position: "relative",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            height: "100%",
          }}
        >
          <div
            aria-hidden
            style={{
              position: "absolute",
              width: 700,
              height: 700,
              borderRadius: "50%",
              background:
                "radial-gradient(circle at 30% 40%, rgba(110,138,111,0.25), transparent 55%), radial-gradient(circle at 70% 70%, rgba(176,123,62,0.18), transparent 60%)",
              filter: "blur(20px)",
              zIndex: 0,
            }}
          />
          <div
            style={{
              position: "relative",
              zIndex: 2,
              width: 900,
            }}
          >
            <CardMount demoData={DEMO_CARD} compact autoAdvanceMs={5000} />
          </div>
        </div>
      </div>

      <div
        className="pagenum-left"
        style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
      >
        bematist.dev ·{" "}
        <XGlyph style={{ width: 14, height: 14, verticalAlign: "middle", color: "currentColor" }} />{" "}
        @bematist_dev
      </div>
    </div>
  );
}

/**
 * Inline X (formerly Twitter) glyph. Official mark path. Sized via the
 * caller's style prop so it scales with surrounding text.
 */
function XGlyph({ style }: { style?: React.CSSProperties }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" role="img" fill="currentColor" style={style}>
      <title>X</title>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}
