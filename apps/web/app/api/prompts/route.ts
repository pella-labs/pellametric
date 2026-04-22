// GET /api/prompts?source=claude|codex&externalSessionId=<sid>
// Returns decrypted prompts for ONE session. Only the owning user can fetch.
// Managers and anyone else get 403 even for sessions in their org.

import { auth } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { and, asc, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { decryptPrompt, getOrCreateUserDek } from "@/lib/crypto/prompts";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const source = url.searchParams.get("source");
  const sid = url.searchParams.get("externalSessionId");
  if (!source || !sid) return NextResponse.json({ error: "missing source or externalSessionId" }, { status: 400 });
  if (source !== "claude" && source !== "codex") return NextResponse.json({ error: "bad source" }, { status: 400 });

  const rows = await db.select().from(schema.promptEvent)
    .where(and(
      eq(schema.promptEvent.userId, session.user.id),
      eq(schema.promptEvent.source, source),
      eq(schema.promptEvent.externalSessionId, sid),
    ))
    .orderBy(asc(schema.promptEvent.tsPrompt));

  if (rows.length === 0) return NextResponse.json({ prompts: [] });

  const dek = await getOrCreateUserDek(session.user.id);
  const prompts = rows.map(r => {
    let text = "";
    try { text = decryptPrompt(dek, { iv: r.iv, tag: r.tag, ciphertext: r.ciphertext }); }
    catch { text = "(decryption failed)"; }
    return {
      id: r.id,
      tsPrompt: r.tsPrompt.toISOString(),
      wordCount: r.wordCount,
      text,
    };
  });
  return NextResponse.json({ prompts });
}
