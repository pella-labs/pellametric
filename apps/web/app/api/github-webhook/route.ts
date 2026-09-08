// POST /api/github-webhook
// X-Hub-Signature-256: sha256=<hmac of raw body using GITHUB_APP_WEBHOOK_SECRET>
// X-GitHub-Event: ping | installation | installation_repositories | pull_request | push
// X-GitHub-Delivery: <uuid>
//
// Single global endpoint (P22). Org is resolved from installation.id.

import { NextResponse } from "next/server";
import { verifyWebhookSignature, parseEventName } from "@/lib/github-webhook";
import { db } from "@/lib/db";
import { org, pr as prTbl } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { hydratePrFromWebhook, handleForcePush } from "@/lib/github-pr-hydrate";

// P30: dedup synchronize events for the same PR within 60s.
const SYNC_DEDUP_MS = 60_000;

export async function POST(req: Request): Promise<NextResponse> {
  const secret = process.env.GITHUB_APP_WEBHOOK_SECRET ?? "";
  if (!secret) {
    return NextResponse.json({ error: "webhook secret not configured" }, { status: 503 });
  }
  const rawBody = await req.text();
  const signature = req.headers.get("x-hub-signature-256") ?? "";
  if (!verifyWebhookSignature(rawBody, signature, secret)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  const event = parseEventName(req.headers.get("x-github-event"));
  if (!event) {
    return NextResponse.json({ ok: true, ignored: "unknown event" });
  }
  if (event === "ping") {
    return NextResponse.json({ ok: true, pong: true });
  }

  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const installationId: number | undefined = payload.installation?.id;
  if (!installationId) {
    return NextResponse.json({ error: "missing installation.id" }, { status: 400 });
  }

  // Resolve org by installation id.
  const orgRow = await db.query.org.findFirst({
    where: eq(org.githubAppInstallationId, installationId),
  });
  if (!orgRow) {
    // App installed for an org we don't know about yet; ack so GitHub stops retrying.
    return NextResponse.json({ ok: true, ignored: "unknown installation" });
  }

  try {
    if (event === "pull_request") {
      const action: string = payload.action;
      if (action === "opened" || action === "synchronize" || action === "closed" || action === "reopened" || action === "edited") {
        if (action === "synchronize") {
          const recent = await db
            .select({ lastSyncedAt: prTbl.lastSyncedAt })
            .from(prTbl)
            .where(
              and(
                eq(prTbl.orgId, orgRow.id),
                eq(prTbl.repo, payload.repository.full_name),
                eq(prTbl.number, payload.pull_request.number),
              ),
            )
            .limit(1);
          if (recent[0] && Date.now() - recent[0].lastSyncedAt.getTime() < SYNC_DEDUP_MS) {
            return NextResponse.json({ ok: true, deduped: "synchronize within 60s" });
          }
        }
        await hydratePrFromWebhook(
          { orgId: orgRow.id, installationId, useCursor: orgRow.useCursor },
          payload.repository,
          payload.pull_request,
        );
      }
    } else if (event === "push") {
      const before: string = payload.before;
      const after: string = payload.after;
      const refStr: string = payload.ref ?? "";
      const headBranch = refStr.startsWith("refs/heads/") ? refStr.slice("refs/heads/".length) : refStr;
      if (headBranch && before && after) {
        await handleForcePush(
          { orgId: orgRow.id, installationId, useCursor: orgRow.useCursor },
          payload.repository.full_name,
          before,
          after,
          headBranch,
        );
      }
    } else if (event === "installation" || event === "installation_repositories") {
      // F4.29 / T6.1 — when the App is freshly installed (or added to new
      // repos), enqueue a backfill_state row so the next backfill cycle picks
      // up this org's recent merged PRs. We only act on the `created` action;
      // the interactive install flow already creates the org row.
      const action: string = payload.action;
      if (action === "created" || action === "added") {
        const { backfillState } = await import("@/lib/db/schema");
        await db
          .insert(backfillState)
          .values({ orgId: orgRow.id, status: "pending" })
          .onConflictDoUpdate({
            target: backfillState.orgId,
            set: { status: "pending", updatedAt: new Date() },
          });
      }
    }
  } catch (err) {
    // Best-effort: log + ack to avoid GitHub retry storms.
    console.error("github-webhook handler error", err);
  }

  return NextResponse.json({ ok: true });
}
