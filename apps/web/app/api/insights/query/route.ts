// POST /api/insights/query
// Body: { query: InsightQuery, scope: { kind, orgSlug, userId? } }
// Auth: requireMembership() for the org. Manager queries enforce k-anonymity
// in lib/insights/query.ts; this route just routes + validates the request.
// Cache-Control: no-store — these may contain sensitive aggregates.

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireMembership } from "@/lib/auth-middleware";
import { getInsight, type InsightQuery, type InsightScope } from "@/lib/insights/query";

const filterSchema = z.object({
  field: z.enum(["source", "model", "repo", "intent_top", "user", "branch"]),
  values: z.array(z.string()).max(100),
});

const rangeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("preset"), preset: z.enum(["7d", "30d", "90d"]) }),
  z.object({ kind: z.literal("absolute"), from: z.string(), to: z.string() }),
]);

const querySchema = z.object({
  metric: z.enum([
    "tokens_out",
    "tokens_in",
    "tokens_cache_read",
    "cost_usd",
    "sessions",
    "wall_sec",
    "errors",
    "prs_merged",
  ]),
  breakdown: z.enum(["source", "model", "repo", "intent_top", "user", "day_of_week", "none"]),
  filters: z.array(filterSchema).max(10),
  range: rangeSchema,
  granularity: z.enum(["day", "week"]),
});

const bodySchema = z.object({
  query: querySchema,
  scope: z.object({
    kind: z.enum(["org", "user"]),
    orgSlug: z.string(),
    provider: z.string().optional(),
  }),
});

export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation", issues: parsed.error.issues.slice(0, 10) },
      { status: 400 },
    );
  }
  const { query, scope } = parsed.data;

  const auth = await requireMembership(scope.orgSlug, {
    provider: scope.provider ?? "github",
    requiredRole: scope.kind === "org" ? "manager" : undefined,
  });
  if (auth instanceof Response) return auth;

  const compilerScope: InsightScope =
    scope.kind === "org"
      ? { kind: "org", orgId: auth.org.id, managerUserId: auth.userId }
      : { kind: "user", userId: auth.userId, orgId: auth.org.id };

  const result = await getInsight(query as InsightQuery, compilerScope);
  return NextResponse.json(result, {
    headers: { "Cache-Control": "no-store" },
  });
}
