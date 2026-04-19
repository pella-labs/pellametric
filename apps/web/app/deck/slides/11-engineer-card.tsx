"use client";

import { DeveloperCard } from "../components/developer-card";
import { SlideShell } from "../components/slide-shell";

/**
 * Slide 11 — The Engineer's Artifact.
 * Replaces the standalone deck's static PNG screenshot with the live
 * DeveloperCard component. Counter animates up from 0 and streak cells
 * reveal when the slide is active.
 */
export function Slide11EngineerCard({
  totalPages,
  active,
}: {
  totalPages: number;
  active: boolean;
}) {
  return (
    <SlideShell sectionLabel="ENGINEER VIEW" pageNumber={11} totalPages={totalPages}>
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
            Proof of <em>craft</em>, not surveillance.
          </h2>
          <p className="body-text" style={{ marginTop: 32, fontSize: 26 }}>
            Every engineer gets a private, shareable card — a personal artifact of how they work
            with AI. The data was always theirs. We made it legible, and portable.
          </p>

          <ul className="reader-list" style={{ marginTop: 40 }}>
            <li>
              <span className="ink" style={{ fontWeight: 500 }}>
                Tokens generated.
              </span>{" "}
              <span className="muted">Self-reference, not a leaderboard.</span>
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
            <li>
              <span className="ink" style={{ fontWeight: 500 }}>
                Private by default.
              </span>{" "}
              <span className="muted">
                Share when{" "}
                <em style={{ fontStyle: "normal" }} className="accent">
                  you
                </em>{" "}
                choose to.
              </span>
            </li>
          </ul>

          <div style={{ marginTop: 40, display: "flex", gap: 16, flexWrap: "wrap" }}>
            <span className="badge accent">SHAREABLE</span>
            <span className="badge">PRIVATE BY DEFAULT</span>
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
          <div style={{ position: "relative", zIndex: 2 }}>
            <DeveloperCard active={active} />
          </div>
        </div>
      </div>
    </SlideShell>
  );
}
