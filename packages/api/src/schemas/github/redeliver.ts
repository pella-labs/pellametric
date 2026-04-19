import { z } from "zod";

/**
 * PRD §14 — `POST /api/admin/github/redeliver`.
 *
 * Replay webhooks within a time range by calling the GitHub App
 * `GET /app/hook/deliveries` + `POST /app/hook/deliveries/:id/attempts` APIs.
 *
 * Rate-limit posture (PRD §11.2, risk #6):
 *   - per-installation token bucket, 1 req/s floor
 *   - exponential backoff on 429 / secondary-rate-limit 403
 *   - never saturate neighbors — each installation has its own 5k/hr quota
 *
 * Body bounds inclusive. `event_types` is an optional filter — when omitted
 * we replay every delivery in the window. We cap the inclusive window at
 * 7 days to match the `X-GitHub-Delivery` dedup TTL — redelivering older
 * messages would be pointless because ingest dedup would drop them.
 */

export const RedeliverWebhooksInput = z
  .object({
    installation_id: z
      .string()
      .regex(/^\d+$/, "installation_id must be a numeric string")
      .optional(),
    from: z.string().datetime({ message: "from must be ISO-8601 UTC" }),
    to: z.string().datetime({ message: "to must be ISO-8601 UTC" }),
    /**
     * Optional: filter by event type, e.g. `['pull_request','push']`. Each
     * entry must match GitHub's event type slug (lowercase, underscores).
     */
    event_types: z
      .array(
        z
          .string()
          .regex(
            /^[a-z][a-z0-9_]{0,63}$/,
            "event_type must be [a-z0-9_], start with a letter, max 64 chars",
          ),
      )
      .max(32)
      .optional(),
  })
  .refine((v) => new Date(v.from).getTime() < new Date(v.to).getTime(), {
    message: "from must be before to",
    path: ["from"],
  })
  .refine(
    (v) => {
      const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
      return new Date(v.to).getTime() - new Date(v.from).getTime() <= SEVEN_DAYS_MS;
    },
    {
      message: "window cannot exceed 7 days (matches webhook dedup TTL)",
      path: ["to"],
    },
  );
export type RedeliverWebhooksInput = z.infer<typeof RedeliverWebhooksInput>;

export const RedeliverWebhooksOutput = z.object({
  installation_id: z.string(),
  /** Count of deliveries GitHub returned in the window after filters applied. */
  deliveries_requested: z.number().int().nonnegative(),
  /**
   * Count of successful `POST /app/hook/deliveries/:id/attempts` calls.
   * 429/5xx-failed deliveries land in the `failed_attempts` count instead.
   */
  queued_attempts: z.number().int().nonnegative(),
  failed_attempts: z.number().int().nonnegative(),
  /** Total wall-clock seconds — observability surface for rate-limit debugging. */
  elapsed_seconds: z.number().nonnegative(),
});
export type RedeliverWebhooksOutput = z.infer<typeof RedeliverWebhooksOutput>;

export const REDELIVER_WINDOW_DAYS = 7;
