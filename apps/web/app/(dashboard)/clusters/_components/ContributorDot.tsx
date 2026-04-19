import type { schemas } from "@bematist/api";
import Image from "next/image";

/**
 * Color-dot pseudonymization for cluster contributors.
 *
 * Compliance ON (default polarity): IC names are hidden — each contributor
 * renders as a deterministic colored dot derived from the engineer hash.
 * The same engineer always paints the same color across Twin Finder + cluster
 * views, without ever surfacing identity. Per CLAUDE.md §Scoring Rules.
 *
 * Compliance OFF (demo path): when the parent passes a `developer` prop, the
 * component renders the GitHub avatar (when present) instead of the dot. The
 * label rendered next to the dot is the parent's responsibility.
 *
 * Pure server component — no JS shipped to the client.
 */
export interface ContributorDotProps {
  /** Opaque `eh_*` hash from the API. NEVER pass a raw engineer_id. */
  hash: string;
  /** Diameter in px; default 10. */
  size?: number;
  /**
   * Compliance-OFF demo identity. When present, renders the avatar
   * (`developer.image`) instead of the dot. Absent in the default path.
   */
  developer?: schemas.DeveloperIdentity;
}

export function ContributorDot({ hash, size = 10, developer }: ContributorDotProps) {
  if (developer?.image) {
    const dim = size + 6;
    return (
      <Image
        src={developer.image}
        alt=""
        aria-hidden="true"
        width={dim}
        height={dim}
        className="inline-block rounded-full ring-1 ring-border"
      />
    );
  }
  const hue = hashToHue(hash);
  return (
    <span
      aria-hidden="true"
      className="inline-block rounded-full ring-1 ring-border"
      style={{
        width: size,
        height: size,
        backgroundColor: `hsl(${hue}deg 65% 55%)`,
      }}
    />
  );
}

/**
 * Map a hash string to a deterministic hue in [0, 360). FNV-1a 32-bit keeps
 * this cheap + avalanche-good for the short `eh_xxxxxxxx` strings the API
 * returns. No secret material here — it's just a stable coloring.
 */
function hashToHue(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % 360;
}
