import { brand } from "../../brand.config";

/**
 * Shared motion presets — all honor `prefers-reduced-motion: reduce`.
 *
 * Usage with `motion/react`:
 *   <motion.div {...fadeIn}>...</motion.div>
 *
 * Reduced-motion handling happens globally in `theme.css`, which clamps all
 * transitions/animations to ~0ms when the user prefers reduced motion. These
 * presets produce the same shape in both modes — the CSS rule makes them
 * instant when appropriate.
 */

const ease = brand.motion.ease;

export const fadeIn = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: brand.motion.base / 1000, ease },
};

export const slideUp = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: 4 },
  transition: { duration: brand.motion.base / 1000, ease },
};

export const stagger = {
  animate: {
    transition: { staggerChildren: 0.05 },
  },
};
