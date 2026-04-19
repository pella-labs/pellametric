import { listInvites } from "@bematist/api";
import { Badge, Card, CardHeader, CardTitle } from "@bematist/ui";
import type { Metadata } from "next";
import { getSessionCtx } from "@/lib/session";
import { CreateInviteForm } from "./_components/CreateInviteForm";
import { RevokeInviteButton } from "./_components/RevokeInviteButton";

export const metadata: Metadata = {
  title: "Admin · Invites",
};

/**
 * Admin invite list + generate form. RSC-first — the list comes from a
 * direct call to `listInvites` (no Route Handler); mutations happen via
 * Server Actions in `./actions.ts`.
 *
 * Dynamic rendering: `getSessionCtx()` reads request headers, which forces
 * Next into dynamic mode automatically. We never want a cached admin list.
 */
export default async function AdminInvitesPage() {
  const ctx = await getSessionCtx();
  const { invites } = await listInvites(ctx, { include_inactive: false });

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Invites</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Generate a share link to bring a teammate into this org. They sign in with GitHub, land as
          the role you picked, and get a ready-to-run <code className="font-mono">bematist</code>{" "}
          install command.
        </p>
      </header>

      <CreateInviteForm />

      <Card>
        <CardHeader>
          <CardTitle>Active invites</CardTitle>
        </CardHeader>
        {invites.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No active invites. Generate one above to bring a teammate in.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border text-xs text-muted-foreground">
                <tr>
                  <th className="py-2 font-medium">Token</th>
                  <th className="py-2 font-medium">Role</th>
                  <th className="py-2 font-medium">Status</th>
                  <th className="py-2 font-medium">Expires</th>
                  <th className="py-2 font-medium">Created</th>
                  <th className="py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {invites.map((i) => (
                  <tr key={i.id} className="border-b border-border/50">
                    <td className="py-2 font-mono text-xs">{i.token_prefix}</td>
                    <td className="py-2 text-xs">
                      <Badge tone="neutral">{i.role}</Badge>
                    </td>
                    <td className="py-2 text-xs capitalize text-muted-foreground">{i.status}</td>
                    <td className="py-2 font-mono text-xs text-muted-foreground">
                      {new Date(i.expires_at).toLocaleString()}
                    </td>
                    <td className="py-2 font-mono text-xs text-muted-foreground">
                      {new Date(i.created_at).toLocaleString()}
                    </td>
                    <td className="py-2">
                      {i.status === "active" ? <RevokeInviteButton id={i.id} /> : null}
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
