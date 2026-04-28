import { PMonogram } from "./Monogram";

/**
 * BrandMonolith. Glass P monogram center-stage with two counter-rotating
 * rings of product language orbiting it.
 */
export function BrandMonolith() {
  return (
    <section className="mk-monolith" aria-label="Pellametric brand mark">
      <div className="mk-monolith-stage">
        <Ring
          className="mk-ring"
          text="AI SPEND · GIT OUTCOMES · ACCEPTED EDITS · MERGED PRS · VELOCITY · "
          fontSize={24}
          fill="rgba(110,138,111,0.85)"
          letterSpacing={8}
          pathRadius={320}
        />
        <Ring
          className="mk-ring mk-ring-outer"
          text="CLAUDE CODE · CURSOR · CODEX · CLAUDE CODE · CURSOR · CODEX · "
          fontSize={14}
          fill="rgba(176,123,62,0.7)"
          letterSpacing={5}
          pathRadius={440}
        />
        <div className="mk-monogram-frame">
          <PMonogram />
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
  pathRadius,
}: {
  text: string;
  fontSize: number;
  fill: string;
  letterSpacing: number;
  className: string;
  pathRadius: number;
}) {
  // Stable id per radius so inner + outer rings reference distinct paths.
  const pathId = `mk-ring-${pathRadius}`;
  const r = pathRadius;
  const d = `M 500,500 m -${r},0 a ${r},${r} 0 1,1 ${r * 2},0 a ${r},${r} 0 1,1 -${r * 2},0`;
  return (
    <svg
      className={className}
      viewBox="0 0 1000 1000"
      preserveAspectRatio="xMidYMid meet"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <defs>
        <path id={pathId} d={d} fill="none" />
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
