import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

// Where /intro actually sends people. Centralised so the metadata link, the
// noscript fallback, and the runtime redirect all stay in sync.
const FOUNDERS_CALENDAR = "https://calendar.app.google/VrY8s3Ho5Ldd4Wb66";

const TITLE = "Build Pellametric with us · 30-minute intro with the founding team";
const DESCRIPTION =
  "Measure agentic engineering. Meter the spend, map the work, scale what ships. Every token, every tool, every repo — finally counted.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/intro" },
  openGraph: {
    type: "website",
    url: "/intro",
    title: TITLE,
    description: DESCRIPTION,
    siteName: "Pellametric",
  },
  twitter: {
    card: "summary_large_image",
    site: "@pellametric",
    title: TITLE,
    description: DESCRIPTION,
  },
};

// Force per-request render — the bot/human branching has to evaluate the
// User-Agent on every hit, not at build time.
export const dynamic = "force-dynamic";

// Crawlers that fetch link previews. We serve them HTML with full OG tags
// so the unfurl looks right; humans get an immediate server-side redirect
// to the calendar page so the round-trip stays cheap.
const CRAWLER_UA =
  /bot|crawler|spider|facebookexternalhit|slackbot|discordbot|linkedinbot|twitterbot|whatsapp|telegrambot|preview|embedly|skype|line/i;

export default async function IntroPage() {
  const ua = (await headers()).get("user-agent") ?? "";
  if (!CRAWLER_UA.test(ua)) {
    redirect(FOUNDERS_CALENDAR);
  }

  // Crawler / preview branch — render an OG-rich placeholder. Add a
  // meta-refresh + JS replace so any non-bot UA that slips through still
  // ends up on the calendar.
  return (
    <html lang="en">
      <head>
        <meta httpEquiv="refresh" content={`0; url=${FOUNDERS_CALENDAR}`} />
        <script
          // biome-ignore lint/security/noDangerouslySetInnerHtml: intentional JS redirect fallback for crawler UAs; URL is escaped via JSON.stringify
          dangerouslySetInnerHTML={{
            __html: `window.location.replace(${JSON.stringify(FOUNDERS_CALENDAR)});`,
          }}
        />
      </head>
      <body
        style={{
          background: "#0a0b0d",
          color: "#ede8de",
          fontFamily: "Inter, system-ui, sans-serif",
          margin: 0,
          padding: 48,
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          gap: 24,
          textAlign: "center",
        }}
      >
        <h1 style={{ margin: 0, fontSize: 32, fontWeight: 500 }}>{TITLE}</h1>
        <p style={{ margin: 0, fontSize: 18, color: "rgba(237,232,222,0.6)", maxWidth: 640 }}>
          {DESCRIPTION}
        </p>
        <a
          href={FOUNDERS_CALENDAR}
          style={{
            marginTop: 16,
            padding: "16px 32px",
            background: "#6e8a6f",
            color: "#0a0b0d",
            textDecoration: "none",
            fontWeight: 500,
            fontSize: 18,
          }}
        >
          Open the booking page →
        </a>
      </body>
    </html>
  );
}
