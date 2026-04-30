// POST /api/invite/accept
// Manual trigger for the auto-accept flow. Same logic as acceptPendingInvites
// in lib/invite-accept.ts but exposed as an endpoint for cases where the user
// wants to retry without bouncing through /dashboard.

import { auth } from "@/lib/auth";
import { acceptPendingInvites } from "@/lib/invite-accept";
import { headers } from "next/headers";
import { NextResponse } from "next/server";

export async function POST() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const result = await acceptPendingInvites(session.user.id);
  return NextResponse.json(result);
}
