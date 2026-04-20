import { cn, TooltipProvider } from "@bematist/ui";
import type { Metadata } from "next";
import {
  Geist,
  Geist_Mono,
  IBM_Plex_Sans,
  Inter,
  JetBrains_Mono,
  Space_Mono,
} from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null) ??
  "https://bematist.dev";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Bematist",
    template: "%s · Bematist",
  },
  description:
    "Measure agentic engineering output. See the spend. See the work. Scale what ships. Open-source analytics across Claude Code, Codex and the rest of your dev-AI stack.",
  applicationName: "Bematist",
  openGraph: {
    type: "website",
    siteName: "Bematist",
    locale: "en_US",
    url: "/",
    title: "Bematist · Measure agentic engineering output",
    description:
      "See the spend. See the work. Scale what ships. Open-source analytics across Claude Code, Codex and the rest of your dev-AI stack.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Bematist · Measure agentic engineering output",
    description:
      "See the spend. See the work. Scale what ships. Open-source analytics across Claude Code, Codex and the rest of your dev-AI stack.",
  },
};

const fontSans = Geist({
  subsets: ["latin"],
  variable: "--font-sans",
});

const fontMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
});

const fontHeading = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-heading",
});

// Marketing + dashboard shared typography. Inter for UI body, JetBrains Mono
// for inline code / small-caps labels, Space Mono for display headings.
const mkSans = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mk-sans",
});

const mkMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-mk-mono",
});

const mkSys = Space_Mono({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-mk-sys",
});

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={cn(
        "dark antialiased",
        fontSans.variable,
        fontMono.variable,
        fontHeading.variable,
        mkSans.variable,
        mkMono.variable,
        mkSys.variable,
      )}
      suppressHydrationWarning
    >
      <body>
        <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
      </body>
    </html>
  );
}
