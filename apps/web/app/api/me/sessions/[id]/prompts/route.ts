// GET /api/me/sessions/[id]/prompts (P18 — server-side decryption only).
// Only the owning user can decrypt. Manager routes NEVER carry this authority.
// Rate-limited 60/min. Cache-Control: no-store.

import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import { getOrCreateUserDek, decryptPrompt } from "@/lib/crypto/prompts";

// In-memory token bucket per user (60/min sliding). Crude but enough for v1.
const buckets = new Map<string, { count: number; resetAt: number }>();
const LIMIT = 60;
const WINDOW_MS = 60 * 1000;

function rateLimit(userId: string): boolean {
  const now = Date.now();
  const b = buckets.get(userId);
  if (!b || b.resetAt < now) {
    buckets.set(userId, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  if (b.count >= LIMIT) return false;
  b.count++;
  return true;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;
  if (!rateLimit(userId)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "retry-after": "60" } });
  }
  const { id } = await params;

  // Ownership check: session_event row must belong to this user (P18 boundary).
  const sessRow = await db.query.sessionEvent.findFirst({
    where: and(eq(schema.sessionEvent.id, id), eq(schema.sessionEvent.userId, userId)),
  });
  if (!sessRow) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Fetch ciphertext rows.
  const prompts = await db
    .select()
    .from(schema.promptEvent)
    .where(
      and(
        eq(schema.promptEvent.userId, userId),
        eq(schema.promptEvent.source, sessRow.source),
        eq(schema.promptEvent.externalSessionId, sessRow.externalSessionId),
      ),
    );

  const responses = await db
    .select()
    .from(schema.responseEvent)
    .where(
      and(
        eq(schema.responseEvent.userId, userId),
        eq(schema.responseEvent.source, sessRow.source),
        eq(schema.responseEvent.externalSessionId, sessRow.externalSessionId),
      ),
    );

  let dek: Buffer;
  try {
    dek = await getOrCreateUserDek(userId);
  } catch {
    return NextResponse.json({ error: "key_unavailable" }, { status: 503 });
  }

  const decryptedPrompts = prompts.map(p => ({
    id: p.id,
    tsPrompt: p.tsPrompt,
    wordCount: p.wordCount,
    text: decryptPrompt(dek, { iv: p.iv, tag: p.tag, ciphertext: p.ciphertext }),
  }));
  const decryptedResponses = responses.map(r => ({
    id: r.id,
    tsResponse: r.tsResponse,
    wordCount: r.wordCount,
    text: decryptPrompt(dek, { iv: r.iv, tag: r.tag, ciphertext: r.ciphertext }),
  }));

  return new NextResponse(
    JSON.stringify({
      sessionId: id,
      externalSessionId: sessRow.externalSessionId,
      prompts: decryptedPrompts,
      responses: decryptedResponses,
    }),
    {
      status: 200,
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    },
  );
}
