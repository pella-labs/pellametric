// POST /api/invite/accept   — dev claims any invite matching their GitHub login

import { auth } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { and, eq, isNull } from "drizzle-orm";
import { headers } from "next/headers";
import { NextResponse } from "next/server";

export async function POST() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const [u] = await db.select().from(schema.user).where(eq(schema.user.id, session.user.id)).limit(1);
  if (!u?.githubLogin) return NextResponse.json({ error: "no github login on account" }, { status: 400 });

  const pending = await db
    .select()
    .from(schema.invitation)
    .where(and(eq(schema.invitation.githubLogin, u.githubLogin.toLowerCase()), eq(schema.invitation.status, "pending")));

  const accepted: any[] = [];
  for (const inv of pending) {
    await db.insert(schema.membership).values({
      userId: session.user.id, orgId: inv.orgId, role: "dev",
    }).onConflictDoNothing();
    await db.update(schema.invitation)
      .set({ status: "accepted", acceptedAt: new Date() })
      .where(eq(schema.invitation.id, inv.id));
    accepted.push(inv);
  }
  return NextResponse.json({ accepted });
}
