import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { db, firebaseConfigured } from "@/lib/firebase/admin";

function stripHtmlTags(obj: unknown): unknown {
  if (typeof obj === "string") return obj.replace(/[<>]/g, "");
  if (Array.isArray(obj)) return obj.map(stripHtmlTags);
  if (obj && typeof obj === "object") {
    const cleaned: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) cleaned[k] = stripHtmlTags(v);
    return cleaned;
  }
  return obj;
}

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

  const tokenDoc = await db.collection("api_tokens").doc(token).get();
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

  const stats = (await req.json()) as Record<string, unknown>;
  if (!stats || typeof stats !== "object" || Array.isArray(stats)) {
    return NextResponse.json({ error: "Missing stats in request body" }, { status: 400 });
  }
  for (const k of ["claude", "codex", "combined"]) {
    const v = (stats as Record<string, unknown>)[k];
    if (!v || typeof v !== "object") {
      return NextResponse.json(
        { error: `stats.${k} is required and must be an object` },
        { status: 400 },
      );
    }
  }

  const serialized = JSON.stringify(stats);
  if (serialized.length > 500 * 1024) {
    return NextResponse.json({ error: "Stats payload too large (max 500KB)" }, { status: 400 });
  }

  const sanitized = stripHtmlTags(stats);
  const uid = tokenData.uid;
  const cardId = uid;

  await db.collection("cards").doc(cardId).set({
    cardId,
    uid,
    stats: sanitized,
    createdAt: FieldValue.serverTimestamp(),
  });
  await db.collection("api_tokens").doc(token).update({ used: true });

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
