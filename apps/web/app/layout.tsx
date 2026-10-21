import "./globals.css";
import type { Metadata, Viewport } from "next";
import UserMenu from "@/components/user-menu";
import AppBrand from "@/components/app-brand";
import {
  Geist,
  Geist_Mono,
  IBM_Plex_Sans,
  Inter,
  JetBrains_Mono,
  Space_Mono,
} from "next/font/google";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://telemetryc.com";

const fontSans = Geist({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});
const fontMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});
const fontHeading = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-heading",
  display: "swap",
});
const mkSans = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mk-sans",
  display: "swap",
});
const mkMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-mk-mono",
  display: "swap",
});
const mkSys = Space_Mono({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-mk-sys",
  display: "swap",
});
const fontNumeric = Space_Mono({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-numeric",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Telemetryc",
    template: "%s · Telemetryc",
  },
  description:
    "Measure agentic engineering. Meter the spend. Map the work. Scale what ships.",
  applicationName: "Telemetryc",
  openGraph: {
    type: "website",
    siteName: "Telemetryc",
    locale: "en_US",
    url: "/",
    title: "Telemetryc · Measure agentic engineering",
    description:
      "Every token, every tool, every repo — finally counted. Analytics across Claude Code, Codex and the rest of your dev-AI stack.",
  },
  twitter: {
    card: "summary_large_image",
    site: "@pellametric",
    title: "Telemetryc · Measure agentic engineering",
    description:
      "Every token, every tool, every repo — finally counted. Analytics across Claude Code, Codex and the rest of your dev-AI stack.",
  },
};

export const viewport: Viewport = {
  // Matches globals.css --background; mobile browser chrome paints dark
  // immediately on first paint instead of flashing white.
  themeColor: "#0a0b0d",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`dark antialiased ${fontSans.variable} ${fontMono.variable} ${fontHeading.variable} ${mkSans.variable} ${mkMono.variable} ${mkSys.variable} ${fontNumeric.variable}`}
      suppressHydrationWarning
    >
      <body className="min-h-screen bg-background text-foreground">
        {children}
        <AppBrand />
        <UserMenu />
      </body>
    </html>
  );
}
