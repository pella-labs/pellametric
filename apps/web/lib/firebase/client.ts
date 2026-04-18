"use client";

import { type FirebaseApp, getApps, initializeApp } from "firebase/app";
import {
  type Auth,
  GithubAuthProvider,
  getAuth,
} from "firebase/auth";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

export const firebaseConfigured = Boolean(firebaseConfig.apiKey);

let _app: FirebaseApp | null = null;
let _auth: Auth | null = null;
let _provider: GithubAuthProvider | null = null;

function init() {
  if (!firebaseConfigured) return;
  if (_app) return;
  _app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
  _auth = getAuth(_app);
  _provider = new GithubAuthProvider();
  _provider.addScope("read:user");
  _provider.addScope("public_repo");
}

init();

/** May be null when Firebase isn't configured. Consumers must guard. */
export const auth: Auth | null = _auth;
export const githubProvider: GithubAuthProvider | null = _provider;
