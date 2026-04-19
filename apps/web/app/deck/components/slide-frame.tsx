"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { type ReactNode, useEffect, useRef, useState } from "react";

/**
 * 16:9 stage wrapper. We render each slide at the canonical 1920×1080 size
 * and use CSS transform to scale it into the stage. This keeps every pixel
 * calculation inside slides identical to the original standalone deck.
 */
export function DeckStage({
  children,
  slideKey,
}: {
  children: ReactNode;
  slideKey: string | number;
}) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const reduce = useReducedMotion();

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const update = () => {
      const rect = el.getBoundingClientRect();
      const sx = rect.width / 1920;
      const sy = rect.height / 1080;
      const s = Math.min(sx, sy);
      setScale(s);
      // Center the scaled slide inside the stage.
      setOffset({
        x: (rect.width - 1920 * s) / 2,
        y: (rect.height - 1080 * s) / 2,
      });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener("resize", update);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);

  return (
    <div className="deck-stage" ref={stageRef}>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={slideKey}
          className="deck-slide"
          initial={reduce ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={reduce ? { opacity: 1 } : { opacity: 0 }}
          transition={{ duration: reduce ? 0 : 0.28, ease: "easeOut" }}
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
          }}
        >
          {children}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
