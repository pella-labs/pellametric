import { cn, TooltipProvider } from "@bematist/ui";
import type { Metadata } from "next";
import { Geist, Geist_Mono, IBM_Plex_Sans } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Bematist",
    template: "%s · Bematist",
  },
  description:
    "Open-source AI-engineering analytics — auto-instruments every developer's coding-agent usage and correlates LLM spend with Git outcomes.",
  applicationName: "Bematist",
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

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={cn("dark antialiased", fontSans.variable, fontMono.variable, fontHeading.variable)}
      suppressHydrationWarning
    >
      <body>
        <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
      </body>
    </html>
  );
}
