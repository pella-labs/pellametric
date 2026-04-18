import "server-only";
import type { DecodedIdToken } from "firebase-admin/auth";
import { adminAuth, firebaseConfigured } from "./admin";

export type AuthResult =
  | { ok: true; user: DecodedIdToken }
  | { ok: false; status: number; error: string };

export async function requireAuth(req: Request): Promise<AuthResult> {
  if (!firebaseConfigured) {
    return {
      ok: false,
      status: 503,
      error: "Firebase service account not configured",
    };
  }
  const header = req.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) {
    return { ok: false, status: 401, error: "Missing or invalid Authorization header" };
  }
  const token = header.split("Bearer ")[1];
  if (!token) {
    return { ok: false, status: 401, error: "Missing or invalid Authorization header" };
  }
  try {
    const decoded = await adminAuth.verifyIdToken(token);
    return { ok: true, user: decoded };
  } catch {
    return { ok: false, status: 401, error: "Invalid or expired token" };
  }
}
