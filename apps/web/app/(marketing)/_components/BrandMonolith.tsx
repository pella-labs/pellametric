import { BMonogram } from "./Monogram";

/**
 * BrandMonolith — signature section.
 * The glass `B` sits dead-center, with two counter-rotating rings of system text
 * orbiting around it. Pure-CSS rotation on the rings keeps the GPU free for the
 * monogram's physical material.
 */
export function BrandMonolith() {
  return (
    <section className="mk-monolith" aria-label="Bematist brand mark">
      <div className="mk-monolith-stage">
        <Ring
          className="mk-ring"
          text="BEMATIST · TELEMETRY · CORRELATION · OUTCOMES · "
          fontSize={24}
          fill="rgba(237,232,222,0.85)"
          letterSpacing={8}
        />
        <Ring
          className="mk-ring mk-ring-outer"
          text="SYS.INIT · COUNTERS · ENVELOPES · GDPR · SELF-HOST · OBSERVABILITY · "
          fontSize={14}
          fill="rgba(176,123,62,0.7)"
          letterSpacing={5}
        />
        <div className="mk-monogram-frame">
          <BMonogram />
        </div>
        <div className="mk-monolith-copy">
          <div className="mk-sys" style={{ marginBottom: 12 }}>
            SYS.MARK // v1.0.0
          </div>
          <p
            className="mk-mono"
            style={{
              fontSize: 14,
              color: "rgba(237,232,222,0.7)",
              lineHeight: 1.6,
            }}
          >
            Drag to rotate. Scroll to zoom. The mark reflects its environment —
            same as the telemetry reflects your team's reality.
          </p>
        </div>
      </div>
    </section>
  );
}

function Ring({
  text,
  fontSize,
  fill,
  letterSpacing,
  className,
}: {
  text: string;
  fontSize: number;
  fill: string;
  letterSpacing: number;
  className: string;
}) {
  const pathId = `mk-ring-${fontSize}`;
  return (
    <svg
      className={className}
      viewBox="0 0 1000 1000"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <defs>
        <path
          id={pathId}
          d="M 500, 500 m -420, 0 a 420,420 0 1,1 840,0 a 420,420 0 1,1 -840,0"
          fill="none"
        />
      </defs>
      <text
        fontFamily="'Space Mono', monospace"
        fontSize={fontSize}
        fontWeight={700}
        fill={fill}
        letterSpacing={letterSpacing}
      >
        <textPath href={`#${pathId}`} startOffset="0%">
          {text.repeat(3)}
        </textPath>
      </text>
    </svg>
  );
}
