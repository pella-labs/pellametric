// GET /api/github-app/install-url?orgSlug=...
// Returns the Pellametric GitHub App install URL for the given org slug, or
// `{ url: null }` when the App isn't configured on this server.

import { NextResponse } from "next/server";
import { installUrl, appConfigured } from "@/lib/github-app";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!appConfigured()) return NextResponse.json({ url: null });
  const { searchParams } = new URL(req.url);
  const orgSlug = searchParams.get("orgSlug");
  if (!orgSlug) return NextResponse.json({ error: "orgSlug required" }, { status: 400 });
  return NextResponse.json({ url: installUrl(orgSlug) });
}
