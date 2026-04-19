"use client";

import { DeckChrome } from "./components/deck-chrome";
import { DeckStage } from "./components/slide-frame";
import { Slide01Cover } from "./slides/01-cover";
import { Slide02Thesis } from "./slides/02-thesis";
import { Slide03FlyingBlind } from "./slides/03-flying-blind";
import { Slide04WhyNow } from "./slides/04-why-now";
import { Slide05ProductOpener } from "./slides/05-product-opener";
import { Slide06ThreeQuestions } from "./slides/06-three-questions";
import { Slide07Platform } from "./slides/07-platform";
import { Slide08Demo } from "./slides/08-demo";
import { Slide09Outcomes } from "./slides/09-outcomes";
import { Slide10TwoReaders } from "./slides/10-two-readers";
import { Slide12QuestionsAnswered } from "./slides/12-questions-answered";
import { Slide13DataWasYours } from "./slides/13-data-was-yours";
import { Slide14Cta } from "./slides/14-cta";
import { useDeckNav } from "./use-deck-nav";

// The former "Engineer Card" slide (slide 11) merged into the CTA slide —
// the card now shows alongside the QR so developers who scan it see the
// artifact they're about to get. `Slide11EngineerCard` is left in the
// slides/ directory for reference but no longer rendered.
const SLIDE_LABELS = [
  "Cover",
  "Thesis",
  "Flying Blind",
  "Why Now",
  "Product Opener",
  "Three Questions",
  "Platform",
  "Demo",
  "Outcomes",
  "Two Readers",
  "Answers",
  "Closing Thesis",
  "Call to Action",
] as const;

const TOTAL = SLIDE_LABELS.length;

export default function DeckPage() {
  const nav = useDeckNav(TOTAL);

  const renderSlide = (i: number, _active: boolean) => {
    switch (i) {
      case 0:
        return <Slide01Cover totalPages={TOTAL} />;
      case 1:
        return <Slide02Thesis totalPages={TOTAL} />;
      case 2:
        return <Slide03FlyingBlind totalPages={TOTAL} />;
      case 3:
        return <Slide04WhyNow totalPages={TOTAL} />;
      case 4:
        return <Slide05ProductOpener totalPages={TOTAL} />;
      case 5:
        return <Slide06ThreeQuestions totalPages={TOTAL} />;
      case 6:
        return <Slide07Platform totalPages={TOTAL} />;
      case 7:
        return <Slide08Demo totalPages={TOTAL} />;
      case 8:
        return <Slide09Outcomes totalPages={TOTAL} />;
      case 9:
        return <Slide10TwoReaders totalPages={TOTAL} />;
      case 10:
        return <Slide12QuestionsAnswered totalPages={TOTAL} />;
      case 11:
        return <Slide13DataWasYours totalPages={TOTAL} />;
      case 12:
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
