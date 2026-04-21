import "./globals.css";
import type { Metadata } from "next";
import { IBM_Plex_Sans, JetBrains_Mono, Space_Mono } from "next/font/google";
import { Geist } from "next/font/google";

const fontSans = Geist({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const fontHeading = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-heading", display: "swap" });
const fontMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });
const fontNumeric = Space_Mono({ subsets: ["latin"], weight: ["400", "700"], variable: "--font-numeric", display: "swap" });

export const metadata: Metadata = {
  title: "pella-metrics",
  description: "Per-dev productivity metrics, org-scoped via GitHub",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`dark antialiased ${fontSans.variable} ${fontHeading.variable} ${fontMono.variable} ${fontNumeric.variable}`}
    >
      <body className="min-h-screen bg-background text-foreground">{children}</body>
    </html>
  );
}
