import type { Metadata } from "next";
import type { ReactNode } from "react";
import "../deck/deck.css";

export const metadata: Metadata = {
  title: "Telemetryc · Roadmap & Vision Deck",
  description:
    "Roadmap & vision deck for Telemetryc — the open-source analytics platform for AI-assisted engineering.",
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: { index: false, follow: false },
  },
  alternates: { canonical: "/roadmap-deck" },
};

export default function RoadmapDeckLayout({ children }: { children: ReactNode }) {
  return <div className="pellametric-deck">{children}</div>;
}
