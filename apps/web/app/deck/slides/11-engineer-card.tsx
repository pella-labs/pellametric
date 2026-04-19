"use client";

import { CardMount } from "../../(marketing)/_card/CardMount";
import { DEMO_CARD } from "../../(marketing)/_card/demo-data";
import { SlideShell } from "../components/slide-shell";

/**
 * Slide 11 — The Engineer's Artifact.
 * Embeds the real shareable card (same component the public /card/[id]
 * route renders) with the shipped DEMO_CARD fixture. `compact` suppresses
 * the download / copy / share bar for in-deck framing. The card runs its
 * own mount animation — `active` is no longer used.
 */
export function Slide11EngineerCard(_props: { totalPages: number; active: boolean }) {
  return (
    <SlideShell sectionLabel="ENGINEER VIEW">
      <div className="eyebrow">08.5 / THE ENGINEER'S ARTIFACT</div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1.1fr 620px",
          gap: 80,
          alignItems: "center",
          flex: 1,
          minHeight: 0,
        }}
      >
        <div>
          <h2 className="title" style={{ fontSize: 76 }}>
            A shareable <em>proof of craft</em>.
          </h2>
          <p className="body-text" style={{ marginTop: 32, fontSize: 26 }}>
            Every engineer gets a personal card — a portable artifact of how they work with AI.
            Tokens, streak, level, badges. Show it on LinkedIn, keep it in your bio, or both.
          </p>

          <ul className="reader-list" style={{ marginTop: 40 }}>
            <li>
              <span className="ink" style={{ fontWeight: 500 }}>
                Tokens generated.
              </span>{" "}
              <span className="muted">A growing counter of your own AI usage.</span>
            </li>
            <li>
              <span className="ink" style={{ fontWeight: 500 }}>
                Streak &amp; activity heatmap.
              </span>{" "}
              <span className="muted">Rhythm of your own practice.</span>
            </li>
            <li>
              <span className="ink" style={{ fontWeight: 500 }}>
                Level + badges.
              </span>{" "}
              <span className="muted">
                Lvl 5 · Senior · Power User — rendered from your history.
              </span>
            </li>
          </ul>

          <div style={{ marginTop: 40, display: "flex", gap: 16, flexWrap: "wrap" }}>
            <span className="badge accent">SHAREABLE</span>
            <span className="badge warm">8 CARDS IN SERIES</span>
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
              // .card-root uses `width: 100%` with no intrinsic width, so
              // the wrapper must establish the card's canvas size itself
              // — otherwise the card collapses to 0 inside a shrinkwrap
              // parent while the surrounding aura still renders. 720px
              // matches the compact min-height for a roughly square
              // framing; scale(0.86) brings rendered width back under the
              // slide's 620px right column.
              width: 720,
              transform: "scale(0.86)",
              transformOrigin: "center",
            }}
          >
            <CardMount demoData={DEMO_CARD} compact />
          </div>
        </div>
      </div>
    </SlideShell>
  );
}
