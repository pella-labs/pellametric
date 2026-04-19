"use server";

// Server Actions backing the /auth/device approve / deny buttons.
//
// Both require a signed-in Better Auth session. The action resolves the
// caller's org via the `users` row, flips device_codes.approved_at /
// denied_at + user_id + org_id atomically, and returns a discriminated
// result the client uses to re-render.
//
// SECURITY — the active user_code is the only piece of shared state the
// browser and CLI agree on. An attacker who can guess an 8-char Crockford
// user_code AND trick a signed-in user into approving it via a forged
// click would gain an ingest key for the attacker's CLI. Mitigations:
//   * Approve requires POST (no GET hijack).
//   * Approve is gated behind the user's Better Auth session (CSRF-token-
//     equivalent; Next.js Server Actions enforce same-origin + token).
//   * The CLI prints the user_code out of band — user is expected to
//     verify it matches before clicking Approve (mirrors `gh auth login`,
//     `gcloud auth login` UX).
//   * Codes expire 10 min after mint.

import { headers } from "next/headers";
import { getAuth } from "@/lib/auth";
import { getDbClients } from "@/lib/db";

type ApproveResult =
  | { ok: true; orgName: string }
  | {
      ok: false;
      reason: "not_signed_in" | "not_found" | "expired" | "already_finalized" | "no_org";
    };

async function resolveUserOrg(betterAuthUserId: string): Promise<{
  userId: string;
  orgId: string;
  orgName: string;
} | null> {
  const { pg } = getDbClients();
  const rows = await pg.query<{
    user_id: string;
    org_id: string;
    org_name: string;
  }>(
    `SELECT u.id AS user_id, o.id AS org_id, o.name AS org_name
     FROM users u
     JOIN orgs  o ON o.id = u.org_id
     WHERE u.better_auth_user_id = $1
     LIMIT 1`,
    [betterAuthUserId],
  );
  const row = rows[0];
  if (!row) return null;
  return { userId: row.user_id, orgId: row.org_id, orgName: row.org_name };
}

export async function approveDeviceAction(userCode: string): Promise<ApproveResult> {
  const hs = await headers();
  const session = await getAuth().api.getSession({ headers: hs });
  if (!session?.user) return { ok: false, reason: "not_signed_in" };

  const org = await resolveUserOrg(session.user.id);
  if (!org) return { ok: false, reason: "no_org" };

  // Conditional UPDATE: only flip the row if it's active (not expired, not
  // already approved/denied/claimed). WHERE clause enforces the invariants
  // server-side — no read-modify-write race.
  const { pg } = getDbClients();
  const rows = await pg.query<{ id: string }>(
    `UPDATE device_codes
        SET user_id     = $1,
            org_id      = $2,
            approved_at = now()
      WHERE user_code   = $3
        AND approved_at IS NULL
        AND denied_at   IS NULL
        AND claimed_at  IS NULL
        AND expires_at  > now()
      RETURNING id`,
    [org.userId, org.orgId, userCode],
  );

  if (rows.length === 0) {
    // Either the code doesn't exist, already finalized, or expired. Check
    // which so we can render a helpful message.
    const status = await pg.query<{
      approved_at: Date | null;
      denied_at: Date | null;
      claimed_at: Date | null;
      expires_at: Date;
    }>(
      `SELECT approved_at, denied_at, claimed_at, expires_at
       FROM device_codes
       WHERE user_code = $1
       LIMIT 1`,
      [userCode],
    );
    const s = status[0];
    if (!s) return { ok: false, reason: "not_found" };
    if (s.expires_at.getTime() < Date.now()) return { ok: false, reason: "expired" };
    return { ok: false, reason: "already_finalized" };
  }

  return { ok: true, orgName: org.orgName };
}

export async function denyDeviceAction(userCode: string): Promise<ApproveResult> {
  const hs = await headers();
  const session = await getAuth().api.getSession({ headers: hs });
  if (!session?.user) return { ok: false, reason: "not_signed_in" };

  const { pg } = getDbClients();
  const rows = await pg.query<{ id: string }>(
    `UPDATE device_codes
        SET denied_at   = now()
      WHERE user_code   = $1
        AND approved_at IS NULL
        AND denied_at   IS NULL
        AND claimed_at  IS NULL
      RETURNING id`,
    [userCode],
  );

  if (rows.length === 0) {
    return { ok: false, reason: "already_finalized" };
  }

  // Return an innocuous ok-shape since the UI treats deny as a terminal
  // success too (the CLI will see denied on its next poll).
  return { ok: true, orgName: "" };
}
