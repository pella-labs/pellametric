import type { Metadata } from "next";
import { headers } from "next/headers";

export const metadata: Metadata = {
  title: "Telemetryc · debug OG",
  robots: { index: false, follow: false },
};

// Re-render on every visit so a fresh deploy shows new hashes.
export const dynamic = "force-dynamic";

/**
 * Dev-only visual grid of every OG image on the site. Unlisted from
 * robots and not linked from the nav; reach it by typing the URL.
 *
 * Next.js serves OG images at hashed paths like
 *   /home/opengraph-image-eyav3z?<file-content-hash>
 * not at the canonical `/home/opengraph-image`. So we fetch each page's
 * rendered HTML server-side and extract the exact og:image URL from the
 * metadata. That way the preview always points at the same image
 * scrapers (Slack, Twitter, etc.) would resolve.
 */
const ROUTES: { label: string; href: string }[] = [
  { label: "Home", href: "/" },
  { label: "Card (generic)", href: "/card" },
  { label: "Card (demo id)", href: "/card/demo" },
];

async function resolveOgUrl(origin: string, path: string): Promise<string | null> {
  try {
    const res = await fetch(`${origin}${path}`, {
      headers: { "user-agent": "Slackbot-LinkExpanding" },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const html = await res.text();
    const match = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

export default async function DebugOgPage() {
  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const protocol = host.startsWith("localhost") ? "http" : "https";
  const origin = `${protocol}://${host}`;
  const nonce = Date.now().toString(36);

  const resolved = await Promise.all(
    ROUTES.map(async (r) => ({
      ...r,
      ogUrl: await resolveOgUrl(origin, r.href),
    })),
  );

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#0a0b0d",
        color: "#ede8de",
        padding: "48px 56px 96px",
        fontFamily: '"Inter", system-ui, sans-serif',
      }}
    >
      <header style={{ marginBottom: 40, maxWidth: 1240 }}>
        <h1 style={{ fontSize: 36, fontWeight: 600, margin: 0, letterSpacing: "-0.02em" }}>
          OG preview
        </h1>
        <p style={{ color: "rgba(237,232,222,0.6)", marginTop: 8, fontSize: 15 }}>
          Resolved from each page's <code style={{ fontFamily: "monospace" }}>og:image</code> meta
          tag. 1200 × 630 native. Hard refresh to pull new hashes after a deploy.
        </p>
      </header>

      <div style={{ display: "grid", gap: 48, maxWidth: 1240 }}>
        {resolved.map((r) => {
          const src = r.ogUrl ? `${r.ogUrl}${r.ogUrl.includes("?") ? "&" : "?"}n=${nonce}` : null;
          return (
            <section key={r.label} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  justifyContent: "space-between",
                  gap: 16,
                  fontSize: 14,
                  color: "rgba(237,232,222,0.6)",
                  fontFamily:
                    '"JetBrains Mono", "Menlo", "ui-monospace", "SFMono-Regular", monospace',
                  letterSpacing: "0.04em",
                }}
              >
                <span style={{ color: "#ede8de", fontSize: 18, letterSpacing: "-0.01em" }}>
                  {r.label}
                </span>
                <div style={{ display: "flex", gap: 18 }}>
                  <a href={r.href} style={{ color: "#6e8a6f", textDecoration: "none" }}>
                    page →
                  </a>
                  {src ? (
                    <a href={src} style={{ color: "#6e8a6f", textDecoration: "none" }}>
                      image →
                    </a>
                  ) : (
                    <span style={{ color: "rgba(237,232,222,0.3)" }}>image: unresolved</span>
                  )}
                </div>
              </div>
              {src ? (
                // biome-ignore lint/performance/noImgElement: dev tool — next/image would re-wrap the URL and break cache-busting
                <img
                  src={src}
                  alt={`${r.label} OG preview`}
                  width={1200}
                  height={630}
                  style={{
                    width: "100%",
                    height: "auto",
                    aspectRatio: "1200 / 630",
                    border: "1px solid rgba(237,232,222,0.12)",
                    borderRadius: 8,
                    background: "#0a0b0d",
                  }}
                />
              ) : (
                <div
                  style={{
                    width: "100%",
                    aspectRatio: "1200 / 630",
                    border: "1px dashed rgba(237,232,222,0.18)",
                    borderRadius: 8,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "rgba(237,232,222,0.4)",
                    fontSize: 14,
                    fontFamily: "monospace",
                  }}
                >
                  Could not resolve og:image for {r.href}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </main>
  );
}
