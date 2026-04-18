import { BMonogram } from "./Monogram";

/**
 * BrandMonolith. Glass B monogram center-stage with two counter-rotating
 * rings of product language orbiting it.
 */
export function BrandMonolith() {
  return (
    <section className="mk-monolith" aria-label="Bematist brand mark">
      <div className="mk-monolith-stage">
        <Ring
          className="mk-ring"
          text="AI SPEND · GIT OUTCOMES · ACCEPTED EDITS · MERGED PRS · VELOCITY · "
          fontSize={24}
          fill="rgba(110,138,111,0.85)"
          letterSpacing={8}
        />
        <Ring
          className="mk-ring mk-ring-outer"
          text="CLAUDE CODE · CURSOR · CODEX · CLAUDE CODE · CURSOR · CODEX · "
          fontSize={14}
          fill="rgba(176,123,62,0.7)"
          letterSpacing={5}
        />
        <div className="mk-monogram-frame">
          <BMonogram />
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
      aria-hidden="true"
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
