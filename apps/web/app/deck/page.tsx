"use client";

import { DeckChrome } from "./components/deck-chrome";
import { DeckStage } from "./components/slide-frame";
import { Slide01Cover } from "./slides/01-cover";
import { Slide03FlyingBlind } from "./slides/03-flying-blind";
import { Slide07Platform } from "./slides/07-platform";
import { Slide08Demo } from "./slides/08-demo";
import { Slide14Cta } from "./slides/14-cta";
import { useDeckNav } from "./use-deck-nav";

// Five-slide pitch cut: intro -> problem -> solution -> demo -> closing.
// The full 13-slide deck's other slide files are left in slides/ for
// reference but no longer rendered.
const SLIDE_LABELS = [
  "Cover",
  "Flying Blind",
  "Platform",
  "Demo",
  "Closing",
] as const;

const TOTAL = SLIDE_LABELS.length;

export default function DeckPage() {
  const nav = useDeckNav(TOTAL);

  const renderSlide = (i: number, _active: boolean) => {
    switch (i) {
      case 0:
        return <Slide01Cover totalPages={TOTAL} />;
      case 1:
        return <Slide03FlyingBlind totalPages={TOTAL} />;
      case 2:
        return <Slide07Platform totalPages={TOTAL} />;
      case 3:
        return <Slide08Demo totalPages={TOTAL} />;
      case 4:
        return <Slide14Cta totalPages={TOTAL} />;
      default:
        return null;
    }
  };

  return (
    <div className="deck-root" role="application" aria-roledescription="slide deck">
      <DeckStage slideKey={nav.index}>{renderSlide(nav.index, true)}</DeckStage>
      <DeckChrome nav={nav} labels={SLIDE_LABELS} />
    </div>
  );
}
