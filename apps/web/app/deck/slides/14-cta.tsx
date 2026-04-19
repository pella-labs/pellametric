import Image from "next/image";
import { RingsBg } from "../components/rings-bg";

export function Slide14Cta(_props: { totalPages: number }) {
  return (
    <div
      className="slide"
      style={{ padding: 0, height: "100%", position: "relative", overflow: "hidden" }}
    >
      <div className="grid-bg" />

      <RingsBg
        outer="START TODAY · JOIN THE MOVEMENT · START TODAY · JOIN THE MOVEMENT · START TODAY · JOIN THE MOVEMENT · "
        inner="APACHE 2.0 · OPEN SOURCE · SELF-HOSTABLE · APACHE 2.0 · OPEN SOURCE · SELF-HOSTABLE · "
        style={{
          right: -250,
          top: "auto",
          bottom: -250,
          width: 1100,
          height: 1100,
          opacity: 0.5,
        }}
      />

      <div className="chrome-row">
        <div className="wordmark">
          <span className="wordmark-dot" /> bematist
        </div>
        <div className="chrome-right">11 / CALL TO ACTION</div>
      </div>

      <div className="cta" style={{ position: "relative", zIndex: 2 }}>
        <div>
          <div className="sys" style={{ marginBottom: 40 }}>
            {"// five minutes to first event"}
          </div>
          <h2>
            Start today.
            <br />
            <em>Join the movement.</em>
          </h2>
          <div className="terminal" style={{ maxWidth: 840, marginTop: 16 }}>
            <div className="term-comment"># signed binary, no proxy, no API keys</div>
            <div>
              <span className="term-prompt">$</span>
              <span className="term-cmd">docker compose up -d</span>
              <span className="term-comment"> # backend</span>
            </div>
            <div>
              <span className="term-prompt">$</span>
              <span className="term-cmd">brew install pella-labs/bematist</span>
            </div>
            <div>
              <span className="term-prompt">$</span>
              <span className="term-cmd">bematist dry-run &amp;&amp; bematist serve</span>
            </div>
          </div>
          <div className="cta-url">→ bematist.dev</div>
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 24,
            alignSelf: "end",
            paddingBottom: 12,
          }}
        >
          <div
            style={{
              width: 360,
              height: 360,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              position: "relative",
              borderRadius: 32,
              overflow: "hidden",
              background: "#fff",
              padding: 18,
              boxSizing: "border-box",
              filter: "drop-shadow(0 24px 48px rgba(110,138,111,0.35))",
            }}
          >
            <Image
              src="/deck/qr-bematist.png"
              alt="QR code — bematist.dev"
              width={320}
              height={320}
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
      </div>

      <div className="pagenum-left">bematist.dev · hello@bematist.dev</div>
    </div>
  );
}
