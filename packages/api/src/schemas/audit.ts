import { z } from "zod";

/**
 * Per-manager-view row (D30). Each time a manager drills into an IC's page or
 * session, a row lands here. The IC's daily digest surfaces them; opt-out is
 * permitted but transparency is the default — never a premium feature.
 */
export const AuditEvent = z.object({
  id: z.string(),
  ts: z.string().datetime(),
  actor_id: z.string(),
  actor_display_name: z.string(),
  actor_role: z.enum(["admin", "manager", "engineer", "auditor", "viewer"]),
  /** The IC being viewed. */
  target_engineer_id: z.string(),
  /** What the actor opened. */
  surface: z.enum(["me_page", "session_detail", "reveal_prompt", "cluster_detail", "csv_export"]),
  /** Populated only for reveal_prompt / csv_export. */
  reason: z.string().nullable(),
  /** Session ID when applicable. */
  session_id: z.string().nullable(),
});
export type AuditEvent = z.infer<typeof AuditEvent>;

export const MyViewHistoryInput = z.object({
  window: z.enum(["24h", "7d", "30d"]).default("24h"),
});
export type MyViewHistoryInput = z.infer<typeof MyViewHistoryInput>;

export const MyViewHistoryOutput = z.object({
  window: z.enum(["24h", "7d", "30d"]),
  events: z.array(AuditEvent),
  /** Whether the IC has toggled into immediate notifications (Web Push). */
  notification_pref: z.enum(["daily_digest", "immediate", "opted_out"]),
});
export type MyViewHistoryOutput = z.infer<typeof MyViewHistoryOutput>;
