import { z } from "zod";
import { Display } from "../gates";

export const Window = z.enum(["7d", "30d", "90d"]);
export type Window = z.infer<typeof Window>;

/**
 * Wrap a numeric field so it's either a real number with `show: true`, or
 * suppressed with a reason. Matches `ScoringOutput.display` in contract 04.
 */
export const Gated = <T extends z.ZodTypeAny>(inner: T) =>
  z.union([
    z.object({ show: z.literal(true), value: inner }),
    z.object({
      show: z.literal(false),
      suppression_reason: z.string(),
      failed_gates: z.array(z.string()),
    }),
  ]);

/** Utility for queries that return a `Display`-shaped payload. */
export { Display };

export const TimeseriesPoint = z.object({
  x: z.string(), // ISO date or bucket label
  y: z.number(),
});
export type TimeseriesPoint = z.infer<typeof TimeseriesPoint>;

export const Confidence = z.enum(["high", "medium", "low"]);
export type Confidence = z.infer<typeof Confidence>;

export const Fidelity = z.enum(["full", "estimated", "aggregate-only", "post-migration"]);
export type Fidelity = z.infer<typeof Fidelity>;
