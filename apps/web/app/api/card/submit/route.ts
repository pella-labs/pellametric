import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db, firebaseConfigured } from "@/lib/firebase/admin";
import { hashToken } from "../token/route";

// Narrow, strict shape for CLI-submitted stats. Matches CardData.stats in
// apps/web/app/(marketing)/_card/card-utils.ts. Unknown fields at the top
// level are rejected. Leaves of the tree are numbers/strings/enums so there's
// no path for scripty payloads to reach the dashboard.
const numberDict = z.record(
  z.string(),
  z.object({ sessions: z.number(), cost: z.number() }),
);
const toolList = z.array(z.object({ name: z.string().max(120), count: z.number() }));

const statsSchema = z
  .object({
    claude: z
      .object({
        sessions: z.number(),
        cost: z.number(),
        inputTokens: z.number(),
        outputTokens: z.number(),
        cacheReadTokens: z.number(),
        cacheCreateTokens: z.number(),
        cacheSavingsUsd: z.number(),
        models: numberDict,
        topTools: toolList,
        totalToolCalls: z.number().optional(),
        hourDistribution: z.array(z.number()).length(24),
        activeDays: z.number(),
        projects: z
          .array(
            z.object({
              name: z.string().max(200),
              sessions: z.number(),
              cost: z.number(),
            }),
          )
          .optional(),
      })
      .strict(),
    codex: z
      .object({
        sessions: z.number(),
        cost: z.number(),
        inputTokens: z.number(),
        cachedInputTokens: z.number(),
        outputTokens: z.number(),
        models: numberDict,
        activeDays: z.number().optional(),
        projects: z
          .array(
            z.object({
              name: z.string().max(200),
              sessions: z.number(),
              cost: z.number(),
            }),
          )
          .optional(),
        topTools: toolList.optional(),
        totalToolCalls: z.number().optional(),
        totalReasoningBlocks: z.number().optional(),
        totalWebSearches: z.number().optional(),
      })
      .strict(),
    combined: z
      .object({
        totalCost: z.number(),
        totalSessions: z.number(),
        totalInputTokens: z.number(),
        totalOutputTokens: z.number(),
        totalActiveDays: z.number().optional(),
        dailyDistribution: z
          .array(
            z.object({
              date: z.string().max(40),
              sessions: z.number(),
              cost: z.number(),
              claudeSessions: z.number(),
              codexSessions: z.number(),
            }),
          )
          .optional(),
      })
      .strict(),
    // highlights is optional and accepts an open shape for forward-compat
    highlights: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export async function POST(req: Request) {
  if (!firebaseConfigured) {
    return NextResponse.json(
      { error: "Firebase service account not configured" },
      { status: 503 },
    );
  }

  const header = req.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) {
    return NextResponse.json(
      { error: "Missing or invalid Authorization header" },
      { status: 401 },
    );
  }
  const token = header.split("Bearer ")[1];
  const tokenHash = hashToken(token);

  const tokenDoc = await db.collection("api_tokens").doc(tokenHash).get();
  if (!tokenDoc.exists) {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  const tokenData = tokenDoc.data()!;
  if (tokenData.used) {
    return NextResponse.json({ error: "Token has already been used" }, { status: 401 });
  }

  const expiresAt = tokenData.expiresAt.toDate
    ? tokenData.expiresAt.toDate()
    : new Date(tokenData.expiresAt);
  if (expiresAt < new Date()) {
    return NextResponse.json({ error: "Token has expired" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parse = statsSchema.safeParse(body);
  if (!parse.success) {
    return NextResponse.json(
      { error: "Invalid stats payload", issues: parse.error.issues.slice(0, 5) },
      { status: 400 },
    );
  }

  const serialized = JSON.stringify(parse.data);
  if (serialized.length > 500 * 1024) {
    return NextResponse.json({ error: "Stats payload too large (max 500KB)" }, { status: 400 });
  }

  const uid = tokenData.uid;
  const cardId = uid;

  await db.collection("cards").doc(cardId).set({
    cardId,
    uid,
    stats: parse.data,
    createdAt: FieldValue.serverTimestamp(),
  });
  await db.collection("api_tokens").doc(tokenHash).update({ used: true });

  const oldTokens = await db
    .collection("api_tokens")
    .where("uid", "==", uid)
    .where("used", "==", true)
    .get();
  if (!oldTokens.empty) {
    const batch = db.batch();
    oldTokens.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }

  const baseUrl = process.env.APP_URL || "http://localhost:3000";
  return NextResponse.json({ cardUrl: `${baseUrl}/card/${cardId}`, cardId });
}
