// POST /api/tokens   -> issue collector token (once, value shown once)
// GET  /api/tokens   -> list user's tokens (without plaintext)

import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { withAuth } from "@/lib/api/with-auth";

export const GET = withAuth(async (_req, { userId }) => {
  const rows = await db.select({
    id: schema.apiToken.id, name: schema.apiToken.name,
    createdAt: schema.apiToken.createdAt, lastUsedAt: schema.apiToken.lastUsedAt,
    revokedAt: schema.apiToken.revokedAt,
  }).from(schema.apiToken).where(eq(schema.apiToken.userId, userId));
  return NextResponse.json({ tokens: rows });
});

export const POST = withAuth(async (req, { userId }) => {
  const body = await req.json().catch(() => ({}));
  const name = (body?.name as string) || "collector";
  const plain = "pm_" + crypto.randomBytes(24).toString("base64url");
  const hash = crypto.createHash("sha256").update(plain).digest("hex");
  const [row] = await db.insert(schema.apiToken).values({
    userId, name, tokenHash: hash,
  }).returning();
  return NextResponse.json({ id: row.id, token: plain, createdAt: row.createdAt });
});
