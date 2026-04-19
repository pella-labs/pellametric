// POST /api/auth/device/poll — CLI polls for approval status.
//
// Shape follows RFC 8628 §3.4/§3.5 but flattens errors into a single `status`
// discriminator (see DevicePollResponse in @bematist/api/schemas/deviceAuth).
//
// Anonymous (authenticated by possession of the unguessable device_code).
//
// One-shot claim semantics: on the FIRST successful poll after approval we
// mint an ingest_keys row scoped to the approved user's org, stamp
// `claimed_at + ingest_key_id` on device_codes, and return the plaintext
// bearer. Subsequent polls return "denied" so a leaked response can't be
// reused. The mint happens here (not in the approve action) so the bearer
// plaintext never sits in the DB between approve and claim.

import { createHash, randomBytes } from "node:crypto";
import {
  type DevicePollResponse,
  DevicePollRequest,
} from "@bematist/api/schemas/deviceAuth";
import { NextResponse } from "next/server";
import { getDbClients } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KEY_ID_LEN = 12;
const KEY_SECRET_BYTES = 32;
const KEY_ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

function sha256Hex(v: string): string {
  return createHash("sha256").update(v).digest("hex");
}

function randomKeyId(): string {
  const bytes = randomBytes(9);
  let out = "";
  for (let i = 0; i < KEY_ID_LEN; i++) {
    const b = bytes[i % bytes.length] ?? 0;
    out += KEY_ID_ALPHABET[b % KEY_ID_ALPHABET.length];
  }
  return out;
}

function randomSecret(): string {
  return randomBytes(KEY_SECRET_BYTES).toString("hex");
}

function ingestPublicUrl(): string {
  return process.env.BEMATIST_INGEST_PUBLIC_URL ?? "https://ingest.bematist.dev";
}

interface DeviceCodeRow {
  id: string;
  user_id: string | null;
  org_id: string | null;
  ingest_key_id: string | null;
  approved_at: Date | null;
  denied_at: Date | null;
  claimed_at: Date | null;
  expires_at: Date;
  user_agent: string | null;
  org_slug: string | null;
  org_name: string | null;
  user_email: string | null;
}

async function loadRow(
  pg: ReturnType<typeof getDbClients>["pg"],
  deviceCodeHash: string,
): Promise<DeviceCodeRow | null> {
  const rows = await pg.query<DeviceCodeRow>(
    `SELECT
       dc.id,
       dc.user_id,
       dc.org_id,
       dc.ingest_key_id,
       dc.approved_at,
       dc.denied_at,
       dc.claimed_at,
       dc.expires_at,
       dc.user_agent,
       o.slug  AS org_slug,
       o.name  AS org_name,
       u.email AS user_email
     FROM device_codes dc
     LEFT JOIN orgs  o ON o.id = dc.org_id
     LEFT JOIN users u ON u.id = dc.user_id
     WHERE dc.device_code_hash = $1
     LIMIT 1`,
    [deviceCodeHash],
  );
  return rows[0] ?? null;
}

function pending(): DevicePollResponse {
  return { status: "pending" };
}
function expired(): DevicePollResponse {
  return { status: "expired" };
}
function denied(): DevicePollResponse {
  return { status: "denied" };
}

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const parsed = DevicePollRequest.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", detail: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const deviceCodeHash = sha256Hex(parsed.data.device_code);
  const { pg } = getDbClients();

  const row = await loadRow(pg, deviceCodeHash);
  if (!row) {
    // Unknown hash — either the CLI fabricated one or it was pruned.
    // Returning "expired" is benign (the CLI prompts a retry) and avoids
    // leaking whether a hash is valid-but-unapproved.
    return NextResponse.json(expired(), { headers: { "Cache-Control": "no-store" } });
  }

  if (row.expires_at.getTime() < Date.now()) {
    return NextResponse.json(expired(), { headers: { "Cache-Control": "no-store" } });
  }
  if (row.denied_at) {
    return NextResponse.json(denied(), { headers: { "Cache-Control": "no-store" } });
  }
  if (row.claimed_at) {
    // Already successfully polled once — one-shot. Return denied so the CLI
    // doesn't assume it can re-read the bearer.
    return NextResponse.json(denied(), { headers: { "Cache-Control": "no-store" } });
  }
  if (!row.approved_at || !row.user_id || !row.org_id || !row.org_slug) {
    return NextResponse.json(pending(), { headers: { "Cache-Control": "no-store" } });
  }

  // Approved and not claimed → mint ingest key + mark claimed atomically.
  //
  // Atomicity is enforced by a conditional UPDATE on claimed_at: if another
  // in-flight poll beat us to it, the UPDATE affects 0 rows and we fall
  // through to "denied" below. We don't use SELECT FOR UPDATE because the
  // app connection pool is small and a write-side CAS is cheaper than a
  // row-level lock for this rate.
  const keyId = randomKeyId();
  const secret = randomSecret();
  const keySha256 = sha256Hex(secret);
  const keyName = row.user_agent
    ? `device: ${row.user_agent.slice(0, 120)}`
    : "device: bematist login";

  // Insert ingest_keys first; if the claim CAS loses, we'll have an orphan
  // row that the admin can revoke manually (safer than partially-consuming
  // the claim without having a key to return). Future nightly-janitor can
  // reap ingest_keys rows with no referencing device_codes ticket.
  await pg.query(
    `INSERT INTO ingest_keys (id, org_id, engineer_id, name, key_sha256, tier_default)
     VALUES ($1, $2, NULL, $3, $4, 'B')`,
    [keyId, row.org_id, keyName, keySha256],
  );

  const claimed = await pg.query<{ id: string }>(
    `UPDATE device_codes
        SET claimed_at    = now(),
            ingest_key_id = $1
      WHERE id            = $2
        AND claimed_at    IS NULL
        AND approved_at   IS NOT NULL
      RETURNING id`,
    [keyId, row.id],
  );

  if (claimed.length === 0) {
    // Lost the race — revoke our minted key so it doesn't dangle. Another
    // poll will have mint its own key and stamped claimed_at.
    await pg.query(`UPDATE ingest_keys SET revoked_at = now() WHERE id = $1`, [keyId]);
    return NextResponse.json(denied(), { headers: { "Cache-Control": "no-store" } });
  }

  const response: DevicePollResponse = {
    status: "approved",
    bearer: `bm_${row.org_slug}_${keyId}_${secret}`,
    endpoint: ingestPublicUrl(),
    org_slug: row.org_slug,
    org_name: row.org_name ?? row.org_slug,
    user_email: row.user_email ?? undefined,
  };
  return NextResponse.json(response, { headers: { "Cache-Control": "no-store" } });
}
