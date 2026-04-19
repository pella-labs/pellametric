import { listIngestKeys, listOrgDevelopers } from "@bematist/api";
import { Badge, Card, CardHeader, CardTitle } from "@bematist/ui";
import type { Metadata } from "next";
import { getSessionCtx } from "@/lib/session";
import { MintKeyForm } from "./_components/MintKeyForm";
import { RevokeKeyButton } from "./_components/RevokeKeyButton";

export const metadata: Metadata = {
  title: "Admin · Ingest keys",
};

/**
 * Admin list + mint form. RSC-first — the list comes from a direct call to
 * `listIngestKeys` (no Route Handler), the mutations happen via Server
 * Actions in `./actions.ts`.
 *
 * Dynamic rendering: `getSessionCtx()` reads request headers, which forces
 * Next into dynamic mode automatically. We never want a cached admin list.
 */
export default async function AdminIngestKeysPage() {
  const ctx = await getSessionCtx();
  const [{ keys }, { developers }] = await Promise.all([
    listIngestKeys(ctx, { include_revoked: false }),
    listOrgDevelopers(ctx, {}),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Ingest keys</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Mint bearer tokens for teammates so their <code className="font-mono">bematist</code>{" "}
          collector can POST events. Only the sha256 is stored — the plaintext is displayed exactly
          once at mint time. Revoked keys take effect within 60 seconds.
        </p>
      </header>

      <MintKeyForm developers={developers.map((d) => ({ id: d.id, email: d.email }))} />

      <Card>
        <CardHeader>
          <CardTitle>Active keys</CardTitle>
        </CardHeader>
        {keys.length === 0 ? (
          <p className="text-sm text-muted-foreground">No active keys. Mint one above.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border text-xs text-muted-foreground">
                <tr>
                  <th className="py-2 font-medium">Name</th>
                  <th className="py-2 font-medium">Engineer</th>
                  <th className="py-2 font-medium">Prefix</th>
                  <th className="py-2 font-medium">Tier</th>
                  <th className="py-2 font-medium">Created</th>
                  <th className="py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => (
                  <tr key={k.id} className="border-b border-border/50">
                    <td className="py-2">{k.name}</td>
                    <td className="py-2 text-xs text-muted-foreground">
                      {k.engineer_email ?? "— (org-shared)"}
                    </td>
                    <td className="py-2 font-mono text-xs">{k.prefix}</td>
                    <td className="py-2">
                      <Badge tone={k.tier_default === "A" ? "neutral" : "neutral"}>
                        Tier {k.tier_default}
                      </Badge>
                    </td>
                    <td className="py-2 font-mono text-xs text-muted-foreground">
                      {new Date(k.created_at).toLocaleString()}
                    </td>
                    <td className="py-2">
                      <RevokeKeyButton id={k.id} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
