import { z } from "zod";

/**
 * OAuth 2.0 Device Authorization Grant (RFC 8628) — the contract that
 * `bematist login` and the web backend exchange.
 *
 * Flow:
 *   1. CLI POSTs /api/auth/device/code → gets {device_code, user_code,
 *      verification_uri_complete, expires_in, interval}.
 *   2. CLI opens verification_uri_complete in the user's browser.
 *   3. User signs in (Better Auth / GitHub OAuth) and lands on
 *      /auth/device?code=<user_code>, clicks Approve. Server side that
 *      flips device_codes.approved_at + mints an ingest_keys row scoped
 *      to the user's org, and records ingest_key_id on the device_codes
 *      row.
 *   4. CLI polls /api/auth/device/poll every `interval` seconds. While
 *      unapproved it gets {status: "pending"}. Once approved it gets
 *      {status: "approved", bearer, endpoint, org_slug, org_name}.
 *   5. CLI writes BEMATIST_ENDPOINT + BEMATIST_TOKEN to ~/.bematist/config.env
 *      and calls `bematist start`.
 *
 * Security invariants:
 *   * device_code plaintext is returned exactly once from /code and never
 *     stored — only its SHA-256 lives in the DB (mirrors ingest_keys).
 *   * bearer plaintext is returned exactly once from /poll on the first
 *     successful poll. Subsequent polls return "denied" (one-shot claim).
 *   * Approval requires an authenticated Better Auth session with an org
 *     membership — the approve path derives org_id from the user's row,
 *     never from client input.
 */

/** RFC 8628 §3.5 errors + our "approved" success variant, flattened into
 *  a single discriminator the CLI can switch on without a separate error
 *  wrapper. Unlike the OAuth spec we never return `access_denied` vs
 *  `expired_token` separately — a denied / expired row surfaces to the
 *  user in the same way (login failed, start over). */
export const DevicePollStatus = z.enum([
  /** User hasn't approved yet. Keep polling. */
  "pending",
  /** CLI is polling too frequently; back off by `interval` extra seconds. */
  "slow_down",
  /** Code expired before user approved. CLI should restart the flow. */
  "expired",
  /** User clicked Deny, or someone already claimed this code. Terminal. */
  "denied",
  /** Approved; `bearer` / `endpoint` / `org_*` fields are populated. */
  "approved",
]);
export type DevicePollStatus = z.infer<typeof DevicePollStatus>;

// --- /api/auth/device/code (POST) -----------------------------------

/** The CLI sends nothing sensitive; a user-agent hint + device label are
 *  helpful for the approve page so the human sees "bematist v0.1.1 on
 *  seb-macbook-pro" rather than a raw UUID. */
export const DeviceCodeRequest = z.object({
  /** Collector version, e.g. "0.1.1". Shown on the approve page so users
   *  can verify the client they're about to authorize. Free-form string. */
  client_version: z.string().max(64).optional(),
  /** Short machine label: `<hostname> (<os>-<arch>)`. Free-form string.
   *  Shown on the approve page + stored on the minted ingest_keys.name so
   *  admins see per-device entries in /admin/ingest-keys. */
  device_label: z.string().max(128).optional(),
});
export type DeviceCodeRequest = z.input<typeof DeviceCodeRequest>;

export const DeviceCodeResponse = z.object({
  /** 256-bit opaque; never shown to user. CLI sends it back on poll. */
  device_code: z.string(),
  /** 8 chars, Crockford-base32 uppercase: "ABCD1234". Shown in URL + on
   *  the approve page so user confirms the code their terminal printed
   *  matches. */
  user_code: z.string(),
  /** Canonical approve URL minus the code. Surfaced as fallback if the
   *  complete URL's auto-open fails. */
  verification_uri: z.string().url(),
  /** verification_uri + `?code=<user_code>` — what the CLI opens in the
   *  browser. */
  verification_uri_complete: z.string().url(),
  /** Seconds until this code expires (default 600 = 10min). */
  expires_in: z.number().int().positive(),
  /** Seconds the CLI should wait between poll calls (default 5). */
  interval: z.number().int().positive(),
});
export type DeviceCodeResponse = z.infer<typeof DeviceCodeResponse>;

// --- /api/auth/device/poll (POST) -----------------------------------

export const DevicePollRequest = z.object({
  device_code: z.string().min(16),
});
export type DevicePollRequest = z.input<typeof DevicePollRequest>;

/** Single response shape for all statuses; the CLI switches on
 *  `status` and reads the other fields only when applicable. Keeping it
 *  flat (vs. a discriminated union) means the CLI deserializer doesn't
 *  need zod-on-the-wire — it just reads JSON. */
export const DevicePollResponse = z.object({
  status: DevicePollStatus,
  /** Populated when status === "approved". The `bm_<slug>_<id>_<secret>`
   *  bearer the CLI writes into BEMATIST_TOKEN. */
  bearer: z.string().optional(),
  /** Populated when status === "approved". The public ingest URL the CLI
   *  writes into BEMATIST_ENDPOINT (e.g. "https://ingest.bematist.dev"). */
  endpoint: z.string().url().optional(),
  /** Populated when status === "approved". Human-friendly "logged in as
   *  <email> → <org_name>" line the CLI prints. */
  org_slug: z.string().optional(),
  org_name: z.string().optional(),
  user_email: z.string().email().optional(),
  /** Populated when status === "slow_down". Number of extra seconds the
   *  CLI should add to its poll interval. */
  slow_down_by: z.number().int().positive().optional(),
});
export type DevicePollResponse = z.infer<typeof DevicePollResponse>;

// --- approve / deny (server actions on /auth/device page) -----------

export const DeviceApproveInput = z.object({
  user_code: z.string().min(1),
});
export type DeviceApproveInput = z.input<typeof DeviceApproveInput>;

export const DeviceDenyInput = z.object({
  user_code: z.string().min(1),
});
export type DeviceDenyInput = z.input<typeof DeviceDenyInput>;

/** Constants shared by server + CLI. */
export const DEVICE_CODE_EXPIRES_IN_SEC = 600; // 10 min
export const DEVICE_CODE_POLL_INTERVAL_SEC = 5;
export const USER_CODE_LENGTH = 8;
/** Crockford base32 minus 0/O/1/I/L to avoid transcription errors. */
export const USER_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
