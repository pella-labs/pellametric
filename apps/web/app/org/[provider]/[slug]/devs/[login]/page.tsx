// F3.22 — Devs drill-in alias. The detailed per-dev view lives at
// /org/[provider]/[slug]/dev/[login] (singular path, predates this revamp).
// We redirect /devs/[login] → /dev/[login] so the URL referenced from the new
// leaderboard works without duplicating the detail surface.

import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function Page({
  params,
}: {
  params: Promise<{ provider: string; slug: string; login: string }>;
}) {
  const { provider, slug, login } = await params;
  redirect(`/org/${provider}/${slug}/dev/${login}`);
}
