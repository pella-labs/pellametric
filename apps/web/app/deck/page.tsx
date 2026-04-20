"use client";

import { DeckChrome } from "./components/deck-chrome";
import { DeckStage } from "./components/slide-frame";
import { Slide01Cover } from "./slides/01-cover";
import { Slide03FlyingBlind } from "./slides/03-flying-blind";
import { Slide08Demo } from "./slides/08-demo";
import { Slide12ClosingCta } from "./slides/12-closing-cta";
import { Slide15SolutionInstrument } from "./slides/15-solution-instrument";
import { useDeckNav } from "./use-deck-nav";

// Five-slide pitch cut: cover -> problem -> solution -> demo -> closing.
// All other slide files remain in the slides/ dir for reference but are no
// longer rendered.
const SLIDE_LABELS = ["Cover", "Flying Blind", "Solution", "Demo", "Call to Action"] as const;

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
        return <Slide15SolutionInstrument totalPages={TOTAL} />;
      case 3:
        return <Slide08Demo totalPages={TOTAL} />;
      case 4:
        return <Slide12ClosingCta totalPages={TOTAL} />;
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
