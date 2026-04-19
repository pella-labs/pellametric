import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./deck.css";

// Investor-facing pitch deck. Unlisted — not in primary nav, excluded from
// SEO via robots metadata. Distribute the URL directly; search engines are
// told to skip it.
export const metadata: Metadata = {
  title: "Bematist · Pitch Deck",
  description:
    "Investor-facing pitch deck for Bematist — the open-source analytics platform for AI-assisted engineering.",
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: { index: false, follow: false },
  },
  alternates: { canonical: "/deck" },
};

export default function DeckLayout({ children }: { children: ReactNode }) {
  return <div className="bematist-deck">{children}</div>;
}
