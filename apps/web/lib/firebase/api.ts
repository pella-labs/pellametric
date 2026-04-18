"use client";

import { auth } from "./client";

const API_BASE = "/api";

async function authFetch(path: string, options: RequestInit = {}) {
  if (!auth) throw new Error("Firebase not configured");
  const user = auth.currentUser;
  if (!user) throw new Error("Not authenticated");

  const token = await user.getIdToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }
  return res.json();
}

export function getProfile() {
  return authFetch("/user/profile");
}

export function generateCardToken(): Promise<{ token: string }> {
  return authFetch("/card/token", { method: "POST" });
}

export function getCard(cardId: string) {
  return fetch(`${API_BASE}/card/${cardId}`).then((res) => {
    if (!res.ok) throw new Error("Card not found");
    return res.json();
  });
}
