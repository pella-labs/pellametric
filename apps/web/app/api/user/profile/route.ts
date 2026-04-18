import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { adminAuth, db } from "@/lib/firebase/admin";
import { requireAuth } from "@/lib/firebase/require-auth";

async function resolveGithubUsername(numericId: string): Promise<string> {
  try {
    const res = await fetch(`https://api.github.com/user/${numericId}`);
    if (!res.ok) return "";
    const data = await res.json();
    return data.login ?? "";
  } catch {
    return "";
  }
}

export async function GET(req: Request) {
  const auth = await requireAuth(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const uid = auth.user.uid;
  const docRef = db.collection("users").doc(uid);
  const doc = await docRef.get();

  if (doc.exists) {
    const existing = doc.data()!;
    const firebaseUser = await adminAuth.getUser(uid);
    const github = firebaseUser.providerData.find((p) => p.providerId === "github.com");
    const correct = github?.uid ? await resolveGithubUsername(github.uid) : "";
    if (correct && existing.githubUsername !== correct) {
      await docRef.update({
        githubUsername: correct,
        photoURL: firebaseUser.photoURL ?? existing.photoURL ?? "",
        displayName: firebaseUser.displayName ?? existing.displayName ?? "",
        updatedAt: FieldValue.serverTimestamp(),
      });
      const refreshed = await docRef.get();
      return NextResponse.json(refreshed.data());
    }
    return NextResponse.json(existing);
  }

  const firebaseUser = await adminAuth.getUser(uid);
  const github = firebaseUser.providerData.find((p) => p.providerId === "github.com");

  const profile = {
    uid,
    displayName: firebaseUser.displayName ?? "",
    email: firebaseUser.email ?? github?.email ?? "",
    photoURL: firebaseUser.photoURL ?? "",
    githubUsername: github?.uid ? await resolveGithubUsername(github.uid) : "",
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };

  await docRef.set(profile);
  const created = await docRef.get();
  return NextResponse.json(created.data());
}
