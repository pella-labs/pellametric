// POST /api/membership/role  { orgSlug, targetUserId, role: "manager" | "dev" }
// Manager-only. Cannot demote yourself. Cannot demote the last remaining manager.

import { auth } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

const bodySchema = z.object({
  orgSlug: z.string(),
  targetUserId: z.string().min(1),
  role: z.enum(["manager", "dev"]),
});

export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = bodySchema.parse(await req.json());

  const [callerRow] = await db
    .select({ org: schema.org, role: schema.membership.role })
    .from(schema.membership)
    .innerJoin(schema.org, eq(schema.membership.orgId, schema.org.id))
    .where(and(eq(schema.membership.userId, session.user.id), eq(schema.org.slug, body.orgSlug)))
    .limit(1);
  if (!callerRow || callerRow.role !== "manager") {
    return NextResponse.json({ error: "not a manager of this org" }, { status: 403 });
  }

  if (session.user.id === body.targetUserId) {
    return NextResponse.json({ error: "you can't change your own role" }, { status: 400 });
  }

  const [target] = await db.select().from(schema.membership)
    .where(and(eq(schema.membership.userId, body.targetUserId), eq(schema.membership.orgId, callerRow.org.id)))
    .limit(1);
  if (!target) return NextResponse.json({ error: "target is not a member of this org" }, { status: 404 });

  if (target.role === body.role) {
    return NextResponse.json({ ok: true, unchanged: true });
  }

  if (target.role === "manager" && body.role === "dev") {
    const managers = await db.select({ userId: schema.membership.userId })
      .from(schema.membership)
      .where(and(eq(schema.membership.orgId, callerRow.org.id), eq(schema.membership.role, "manager")));
    if (managers.length <= 1) {
      return NextResponse.json({ error: "can't demote the last manager" }, { status: 400 });
    }
  }

  await db.update(schema.membership)
    .set({ role: body.role })
    .where(and(eq(schema.membership.userId, body.targetUserId), eq(schema.membership.orgId, callerRow.org.id)));

  await db.insert(schema.membershipAudit).values({
    orgId: callerRow.org.id,
    targetUserId: body.targetUserId,
    actorUserId: session.user.id,
    fromRole: target.role,
    toRole: body.role,
  });

  return NextResponse.json({ ok: true });
}
