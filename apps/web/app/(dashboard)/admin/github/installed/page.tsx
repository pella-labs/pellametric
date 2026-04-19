import { createSign } from "node:crypto";
import { assertRole } from "@bematist/api";
import { Card, CardHeader, CardTitle } from "@bematist/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionCtx } from "@/lib/session";

export const metadata: Metadata = { title: "Admin · GitHub · Installed" };

/**
 * GitHub App OAuth-during-install callback landing page.
 *
 * GitHub redirects the admin's browser here after they install the App on
 * their org. The URL carries `installation_id` (and, when OAuth-on-install
 * is enabled, a `code` for user identity — we ignore it because the
 * admin's Better Auth session already identifies the tenant).
 *
 * Flow (server-side on this request):
 *   1. Require admin session → tenant_id.
 *   2. Mint a GitHub App JWT and GET /app/installations/:id to pull the
 *      canonical target_type / account.id / account.login / app_id.
 *   3. Upsert a `github_installations` row under (tenant_id, installation_id)
 *      keyed on the composite unique — re-visiting this URL is idempotent.
 *   4. Seed webhook_secret_active_ref = 'dev-default' so the in-process
 *      resolver (seeded from GITHUB_WEBHOOK_SECRET_DEV at ingest boot)
 *      can verify incoming HMACs. Prod will swap in a KMS-backed ref.
 *   5. Redirect to `/admin/github?installed=1`.
 *
 * Safe to hit directly at `/admin/github/installed?installation_id=<id>`
 * without re-installing the App on GitHub — useful when the original
 * callback 404'd (e.g. before this route shipped) and we still need to
 * bind the live installation to the tenant.
 */
type InstalledSearchParams = {
  installation_id?: string | string[];
  setup_action?: string | string[];
};

export default async function GithubInstalledPage({
  searchParams,
}: {
  searchParams: Promise<InstalledSearchParams>;
}) {
  const ctx = await getSessionCtx();
  assertRole(ctx, ["admin"]);

  const sp = (await searchParams) ?? {};
  const rawInstallationId = Array.isArray(sp.installation_id)
    ? sp.installation_id[0]
    : sp.installation_id;

  if (!rawInstallationId || !/^\d+$/.test(rawInstallationId)) {
    return (
      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Missing installation_id</CardTitle>
          </CardHeader>
          <p className="px-6 pb-6 text-sm text-muted-foreground">
            This page expects a numeric <code className="font-mono">installation_id</code> query
            parameter. Install the GitHub App from{" "}
            <Link className="underline" href="/admin/github">
              the GitHub admin page
            </Link>{" "}
            and you'll be redirected back here automatically.
          </p>
        </Card>
      </div>
    );
  }

  const installationId = BigInt(rawInstallationId);
  const appIdRaw = process.env.GITHUB_APP_ID;
  const privateKeyPem = process.env.GITHUB_APP_PRIVATE_KEY_PEM;
  if (!appIdRaw || !privateKeyPem) {
    throw new Error(
      "GITHUB_APP_ID or GITHUB_APP_PRIVATE_KEY_PEM not set — cannot bind installation.",
    );
  }

  const appJwt = mintAppJwt({ appId: appIdRaw, privateKeyPem });
  const ghRes = await fetch(`https://api.github.com/app/installations/${installationId}`, {
    headers: {
      Authorization: `Bearer ${appJwt}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    cache: "no-store",
  });
  if (!ghRes.ok) {
    const body = await ghRes.text().catch(() => "");
    throw new Error(`GitHub installation fetch failed (${ghRes.status}): ${body.slice(0, 200)}`);
  }
  const meta = (await ghRes.json()) as {
    id: number;
    app_id: number;
    target_type: string;
    account: { id: number; login: string };
  };

  const tokenRef = `installation-token-${meta.id}`;
  const webhookSecretRef = "dev-default";

  await ctx.db.pg.query(
    `INSERT INTO github_installations (
       tenant_id, installation_id, github_org_id, github_org_login,
       app_id, status, token_ref, webhook_secret_active_ref, installed_at
     ) VALUES ($1::uuid, $2::bigint, $3::bigint, $4, $5::bigint, 'active', $6, $7, now())
     ON CONFLICT (tenant_id, installation_id) DO UPDATE
       SET github_org_id = EXCLUDED.github_org_id,
           github_org_login = EXCLUDED.github_org_login,
           app_id = EXCLUDED.app_id,
           status = 'active',
           token_ref = EXCLUDED.token_ref,
           webhook_secret_active_ref = COALESCE(
             github_installations.webhook_secret_active_ref,
             EXCLUDED.webhook_secret_active_ref
           ),
           updated_at = now()`,
    [
      ctx.tenant_id,
      meta.id.toString(),
      meta.account.id.toString(),
      meta.account.login,
      meta.app_id.toString(),
      tokenRef,
      webhookSecretRef,
    ],
  );

  // Mark matching pending row claimed so the global-admin view clears.
  await ctx.db.pg.query(
    `UPDATE github_pending_installations
       SET claimed_at = now(), claimed_by_tenant_id = $2::uuid, updated_at = now()
     WHERE installation_id = $1::bigint AND claimed_at IS NULL`,
    [meta.id.toString(), ctx.tenant_id],
  );

  redirect("/admin/github?installed=1");
}

// Inlined from apps/web/lib/github/redeliveryDeps.ts — same signature, avoids
// pulling the full redelivery deps factory just to mint a JWT here.
function base64url(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return buf.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function mintAppJwt({
  appId,
  privateKeyPem,
}: {
  appId: string | number;
  privateKeyPem: string;
}): string {
  const nowSec = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iat: nowSec - 60,
    exp: nowSec + 9 * 60,
    iss: typeof appId === "number" ? appId : Number(appId),
  };
  const headerB64 = base64url(JSON.stringify(header));
  const payloadB64 = base64url(JSON.stringify(payload));
  const signingInput = `${headerB64}.${payloadB64}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign(privateKeyPem);
  return `${signingInput}.${base64url(signature)}`;
}
