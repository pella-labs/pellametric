import "server-only";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

function getServiceAccount(): Record<string, string> | null {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    try {
      return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    } catch {
      return null;
    }
  }
  return null;
}

const serviceAccount = getServiceAccount();

const existing = getApps()[0];
const app = existing
  ? existing
  : serviceAccount
    ? initializeApp({ credential: cert(serviceAccount) })
    : initializeApp();

export const adminAuth = getAuth(app);
export const db = getFirestore(app);
export const firebaseConfigured = serviceAccount !== null;
