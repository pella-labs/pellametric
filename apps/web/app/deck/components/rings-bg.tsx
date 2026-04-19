/**
 * Orbiting twin-ring brand flourish. Pure SVG with CSS-driven rotation
 * (reduced-motion halts the spin via @media query in deck.css).
 */
export function RingsBg({
  outer,
  inner,
  style,
}: {
  outer: string;
  inner: string;
  style?: React.CSSProperties;
}) {
  return (
    <div className="rings-bg" aria-hidden style={style}>
      <svg viewBox="0 0 1000 1000" role="presentation">
        <title>Orbiting brand rings</title>
        <defs>
          <path
            id="deck-p-out"
            d="M 500,500 m -420,0 a 420,420 0 1,1 840,0 a 420,420 0 1,1 -840,0"
            fill="none"
          />
          <path
            id="deck-p-in"
            d="M 500,500 m -300,0 a 300,300 0 1,1 600,0 a 300,300 0 1,1 -600,0"
            fill="none"
          />
        </defs>
        <g className="ring-outer">
          <text
            fontFamily="var(--f-sys)"
            fontSize="24"
            fill="rgba(110,138,111,0.85)"
            letterSpacing="8"
            fontWeight="700"
          >
            <textPath href="#deck-p-out">{outer}</textPath>
          </text>
        </g>
        <g className="ring-inner">
          <text
            fontFamily="var(--f-sys)"
            fontSize="14"
            fill="rgba(176,123,62,0.7)"
            letterSpacing="5"
            fontWeight="700"
          >
            <textPath href="#deck-p-in">{inner}</textPath>
          </text>
        </g>
      </svg>
    </div>
  );
}
