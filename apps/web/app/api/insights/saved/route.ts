// /api/insights/saved
//   GET ?orgSlug=…&scope=org|user  → list rows visible to caller
//   POST  body: { orgSlug, scope, name, description?, queryJson }
//
// Per locked decision §7.3:
//   - scope='org' rows: any manager in the org can see/edit/delete them.
//   - scope='user' rows: only the owning user.
// Devs may only create scope='user' rows.

import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, desc, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { savedInsight } from "@/lib/db/schema";
import { requireMembership } from "@/lib/auth-middleware";

const postBody = z.object({
  orgSlug: z.string(),
  provider: z.string().optional(),
  scope: z.enum(["org", "user"]),
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  queryJson: z.record(z.string(), z.unknown()),
});

export async function GET(req: Request) {
  const url = new URL(req.url);
  const orgSlug = url.searchParams.get("orgSlug") ?? "";
  const scope = url.searchParams.get("scope") ?? "user";
  const auth = await requireMembership(orgSlug, { provider: url.searchParams.get("provider") ?? "github" });
  if (auth instanceof Response) return auth;

  let conds;
  if (scope === "org") {
    if (auth.membership.role !== "manager") {
      return NextResponse.json({ items: [] });
    }
    conds = and(eq(savedInsight.orgId, auth.org.id), eq(savedInsight.scope, "org"));
  } else {
    // user scope: caller's own rows.
    conds = and(
      eq(savedInsight.orgId, auth.org.id),
      eq(savedInsight.scope, "user"),
      eq(savedInsight.userId, auth.userId),
    );
  }
  const rows = await db
    .select()
    .from(savedInsight)
    .where(conds)
    .orderBy(desc(savedInsight.createdAt))
    .limit(200);
  return NextResponse.json(
    { items: rows },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(req: Request) {
  const parsed = postBody.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation", issues: parsed.error.issues.slice(0, 10) },
      { status: 400 },
    );
  }
  const { orgSlug, provider, scope, name, description, queryJson } = parsed.data;
  const auth = await requireMembership(orgSlug, { provider });
  if (auth instanceof Response) return auth;

  // Devs may only save user-scoped insights.
  if (scope === "org" && auth.membership.role !== "manager") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const [row] = await db
    .insert(savedInsight)
    .values({
      orgId: auth.org.id,
      userId: auth.userId,
      scope,
      name,
      description: description ?? null,
      queryJson,
    })
    .returning();
  return NextResponse.json({ item: row });
}
