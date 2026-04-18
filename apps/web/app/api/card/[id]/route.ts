import { NextResponse } from "next/server";
import { db, firebaseConfigured } from "@/lib/firebase/admin";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!firebaseConfigured) {
    return NextResponse.json({ error: "Firebase service account not configured" }, { status: 503 });
  }
  const { id } = await params;
  const doc = await db.collection("cards").doc(id).get();
  if (!doc.exists) {
    return NextResponse.json({ error: "Card not found" }, { status: 404 });
  }
  const data = doc.data()!;
  const userDoc = await db.collection("users").doc(data.uid).get();
  const user = userDoc.exists ? userDoc.data() : null;

  return NextResponse.json({
    cardId: data.cardId,
    stats: data.stats,
    user: user
      ? {
          displayName: user.displayName,
          photoURL: user.photoURL,
          githubUsername: user.githubUsername,
        }
      : null,
    createdAt: data.createdAt,
  });
}
