// DELETE /api/insights/saved/[id]
// Owner (for scope='user') OR any manager in the same org (for scope='org')
// may delete. Lookup-then-check pattern; we don't expose existence to non-members.

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { savedInsight, membership } from "@/lib/db/schema";
import { auth as betterAuth } from "@/lib/auth";
import { headers } from "next/headers";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await betterAuth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const [row] = await db
    .select()
    .from(savedInsight)
    .where(eq(savedInsight.id, id))
    .limit(1);
  if (!row) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  // user-scope: owner only
  if (row.scope === "user") {
    if (row.userId !== session.user.id) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  } else {
    // org-scope: any manager in row.orgId
    const [mem] = await db
      .select()
      .from(membership)
      .where(
        and(
          eq(membership.userId, session.user.id),
          eq(membership.orgId, row.orgId),
        ),
      );
    if (!mem || mem.role !== "manager") {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  }
  await db.delete(savedInsight).where(eq(savedInsight.id, id));
  return NextResponse.json({ ok: true });
}
