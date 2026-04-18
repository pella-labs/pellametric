import { createHash, randomBytes } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { db } from "@/lib/firebase/admin";
import { requireAuth } from "@/lib/firebase/require-auth";

const adjectives = [
  "swift", "cosmic", "neon", "lunar", "pixel", "turbo", "hyper", "cyber", "nova",
  "quantum", "stellar", "arcane", "blazing", "shadow", "golden", "iron", "chrome",
  "electric", "frozen", "silent",
];
const nouns = [
  "falcon", "phoenix", "coder", "spark", "orbit", "pulse", "forge", "nexus", "cipher",
  "vortex", "prism", "atlas", "titan", "raven", "storm", "byte", "flux", "drift",
  "echo", "blade",
];

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function POST(req: Request) {
  const auth = await requireAuth(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const uid = auth.user.uid;
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  const num = Math.floor(Math.random() * 900) + 100;
  const hex = randomBytes(8).toString("hex");
  const token = `bematist_${adj}-${noun}-${num}-${hex}`;
  const tokenHash = hashToken(token);

  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
  await db.collection("api_tokens").doc(tokenHash).set({
    tokenHash,
    uid,
    expiresAt,
    used: false,
    createdAt: FieldValue.serverTimestamp(),
  });

  return NextResponse.json({ token });
}
