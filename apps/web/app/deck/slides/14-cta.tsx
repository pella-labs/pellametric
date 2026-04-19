"use client";

import Image from "next/image";
import { CardMount } from "../../(marketing)/_card/CardMount";
import { DEMO_CARD } from "../../(marketing)/_card/demo-data";

/**
 * Final slide — merges the former "engineer card" slide into the CTA so
 * developers who scan the QR have immediate reason to care: their own
 * card is the first thing they see.
 *
 * Layout: QR + "Start today / Join the movement" on the LEFT, live
 * shareable card on the RIGHT, auto-advancing through all 8 card pages
 * so the audience sees every face without keyboard input.
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
        <div className="chrome-right">11 / CALL TO ACTION</div>
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
            alignItems: "center",
            gap: 28,
          }}
        >
          <div style={{ textAlign: "center" }}>
            <div className="sys" style={{ marginBottom: 16 }}>
              {"// five minutes to first event"}
            </div>
            <h2 style={{ fontSize: 72, lineHeight: 1.05, margin: 0 }}>
              Start today.
              <br />
              <em>Join the movement.</em>
            </h2>
          </div>
          <div
            style={{
              width: 420,
              height: 420,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              position: "relative",
              borderRadius: 40,
              overflow: "hidden",
              background: "#fff",
              padding: 22,
              boxSizing: "border-box",
              filter: "drop-shadow(0 24px 48px rgba(110,138,111,0.35))",
            }}
          >
            <Image
              src="/deck/qr-bematist.png"
              alt="QR code — bematist.dev"
              width={380}
              height={380}
              priority
              style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
            />
          </div>
          <div
            className="sys"
            style={{ textAlign: "center", fontSize: 16, letterSpacing: "0.22em" }}
          >
            SCAN TO INSTALL → BEMATIST.DEV
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
