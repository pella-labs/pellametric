"use client";

import { DeckChrome } from "../deck/components/deck-chrome";
import { DeckStage } from "../deck/components/slide-frame";
import { useDeckNav } from "../deck/use-deck-nav";
import { Slide01Cover } from "./slides/01-cover";
import { Slide02Hook } from "./slides/02-hook";
import { Slide03Market } from "./slides/03-market";
import { Slide05VendorGap } from "./slides/05-vendor-gap";
import { Slide06Solution } from "./slides/06-solution";
import { Slide08ManagerDashboard } from "./slides/08-manager-dashboard";
import { Slide09SoloCards } from "./slides/09-solo-cards";
import { Slide10Privacy } from "./slides/10-privacy";
import { Slide11PerceptionGap } from "./slides/11-perception-gap";
import { Slide12Team } from "./slides/12-team";
import { Slide13Today } from "./slides/13-today";
import { Slide15Roadmap } from "./slides/15-roadmap";
import { Slide18LetsTalk } from "./slides/18-lets-talk";

const SLIDE_LABELS = [
  "Cover",
  "The Hook",
  "Market & Problem",
  "Vendor Gap",
  "Solution",
  "Dashboard",
  "Solo Cards",
  "Privacy & Security",
  "Perception Gap",
  "Team",
  "Today & Next",
  "Roadmap",
  "Let's Talk",
] as const;

const TOTAL = SLIDE_LABELS.length;

export default function RoadmapDeckPage() {
  const nav = useDeckNav(TOTAL);

  const renderSlide = (i: number) => {
    switch (i) {
      case 0:
        return <Slide01Cover totalPages={TOTAL} />;
      case 1:
        return <Slide02Hook totalPages={TOTAL} />;
      case 2:
        return <Slide03Market totalPages={TOTAL} />;
      case 3:
        return <Slide05VendorGap totalPages={TOTAL} />;
      case 4:
        return <Slide06Solution totalPages={TOTAL} />;
      case 5:
        return <Slide08ManagerDashboard totalPages={TOTAL} />;
      case 6:
        return <Slide09SoloCards totalPages={TOTAL} />;
      case 7:
        return <Slide10Privacy totalPages={TOTAL} />;
      case 8:
        return <Slide11PerceptionGap totalPages={TOTAL} />;
      case 9:
        return <Slide12Team totalPages={TOTAL} />;
      case 10:
        return <Slide13Today totalPages={TOTAL} />;
      case 11:
        return <Slide15Roadmap totalPages={TOTAL} />;
      case 12:
        return <Slide18LetsTalk totalPages={TOTAL} />;
      default:
        return null;
    }
  };

  return (
    <div
      className="deck-root"
      role="application"
      aria-roledescription="slide deck"
    >
      <DeckStage slideKey={nav.index}>{renderSlide(nav.index)}</DeckStage>
      <DeckChrome nav={nav} labels={SLIDE_LABELS} />
    </div>
  );
}
