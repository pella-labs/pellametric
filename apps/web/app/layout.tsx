import type { Metadata } from "next";
import type { ReactNode } from "react";
import { TooltipProvider } from "@bematist/ui";
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

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body>
        <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
      </body>
    </html>
  );
}
