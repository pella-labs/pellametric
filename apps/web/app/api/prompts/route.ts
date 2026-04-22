// GET /api/prompts?source=claude|codex&externalSessionId=<sid>
// Returns the decrypted conversation for ONE session (prompts + assistant
// responses interleaved by timestamp). Only the owning user can fetch —
// managers and anyone else get 401 even for sessions in their org.

import { auth } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { and, asc, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { decryptPrompt, getOrCreateUserDek } from "@/lib/crypto/prompts";

export const dynamic = "force-dynamic";

type Turn =
  | { kind: "prompt"; id: string; ts: string; wordCount: number; text: string }
  | { kind: "response"; id: string; ts: string; wordCount: number; text: string };

export async function GET(req: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const source = url.searchParams.get("source");
  const sid = url.searchParams.get("externalSessionId");
  if (!source || !sid) return NextResponse.json({ error: "missing source or externalSessionId" }, { status: 400 });
  if (source !== "claude" && source !== "codex") return NextResponse.json({ error: "bad source" }, { status: 400 });

  const [promptRows, responseRows] = await Promise.all([
    db.select().from(schema.promptEvent)
      .where(and(
        eq(schema.promptEvent.userId, session.user.id),
        eq(schema.promptEvent.source, source),
        eq(schema.promptEvent.externalSessionId, sid),
      ))
      .orderBy(asc(schema.promptEvent.tsPrompt)),
    db.select().from(schema.responseEvent)
      .where(and(
        eq(schema.responseEvent.userId, session.user.id),
        eq(schema.responseEvent.source, source),
        eq(schema.responseEvent.externalSessionId, sid),
      ))
      .orderBy(asc(schema.responseEvent.tsResponse)),
  ]);

  if (promptRows.length + responseRows.length === 0) {
    return NextResponse.json({ turns: [], prompts: [], responses: [] });
  }

  const dek = await getOrCreateUserDek(session.user.id);
  const decrypt = (r: { iv: string; tag: string; ciphertext: string }) => {
    try { return decryptPrompt(dek, r); } catch { return "(decryption failed)"; }
  };

  const turns: Turn[] = [];
  for (const r of promptRows) {
    turns.push({ kind: "prompt", id: r.id, ts: r.tsPrompt.toISOString(), wordCount: r.wordCount, text: decrypt(r) });
  }
  for (const r of responseRows) {
    turns.push({ kind: "response", id: r.id, ts: r.tsResponse.toISOString(), wordCount: r.wordCount, text: decrypt(r) });
  }
  // Merge-sort by timestamp; prompt before response on exact ties so the
  // ordering reads as user → assistant when the ISO timestamps collide.
  turns.sort((a, b) => {
    if (a.ts !== b.ts) return a.ts < b.ts ? -1 : 1;
    if (a.kind === b.kind) return 0;
    return a.kind === "prompt" ? -1 : 1;
  });

  // Keep the old `prompts` field shape for back-compat with existing
  // clients; new clients should read `turns`.
  return NextResponse.json({
    turns,
    prompts: turns.filter(t => t.kind === "prompt").map(t => ({ id: t.id, tsPrompt: t.ts, wordCount: t.wordCount, text: t.text })),
    responses: turns.filter(t => t.kind === "response").map(t => ({ id: t.id, tsResponse: t.ts, wordCount: t.wordCount, text: t.text })),
  });
}
