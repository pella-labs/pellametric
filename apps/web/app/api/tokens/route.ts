// POST /api/tokens   -> issue collector token (once, value shown once)
// GET  /api/tokens   -> list user's tokens (without plaintext)

import { auth } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import crypto from "node:crypto";

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const rows = await db.select({
    id: schema.apiToken.id, name: schema.apiToken.name,
    createdAt: schema.apiToken.createdAt, lastUsedAt: schema.apiToken.lastUsedAt,
    revokedAt: schema.apiToken.revokedAt,
  }).from(schema.apiToken).where(eq(schema.apiToken.userId, session.user.id));
  return NextResponse.json({ tokens: rows });
}

export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const name = (body?.name as string) || "collector";
  const plain = "pm_" + crypto.randomBytes(24).toString("base64url");
  const hash = crypto.createHash("sha256").update(plain).digest("hex");
  const [row] = await db.insert(schema.apiToken).values({
    userId: session.user.id, name, tokenHash: hash,
  }).returning();
  return NextResponse.json({ id: row.id, token: plain, createdAt: row.createdAt });
}
