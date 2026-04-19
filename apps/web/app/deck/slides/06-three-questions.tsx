import { SlideShell } from "../components/slide-shell";

export function Slide06ThreeQuestions({ totalPages }: { totalPages: number }) {
  return (
    <SlideShell sectionLabel="04 / QUESTIONS" pageNumber={6} totalPages={totalPages}>
      <div className="eyebrow">04 / THE QUESTIONS</div>
      <h2 className="title">
        Three questions every leader asks — and <em>can't answer</em>.
      </h2>

      <div className="qcards">
        <div className="qcard">
          <div className="qnum">01</div>
          <h3>Where is spend allocated?</h3>
          <p>Costs broken down by repositories, teams, models, agents, and task type.</p>
          <div className="answer">/summary · /sessions</div>
        </div>
        <div className="qcard">
          <div className="qnum">02</div>
          <h3>What delivers value?</h3>
          <p>Identify sessions that shipped code vs. those that generated cost without outcome.</p>
          <div className="answer">/outcomes</div>
        </div>
        <div className="qcard">
          <div className="qnum">03</div>
          <h3>What drives efficiency?</h3>
          <p>
            Understand why engineers achieve the same task with widely varying token consumption.
          </p>
          <div className="answer">/insights · /clusters</div>
        </div>
      </div>
    </SlideShell>
  );
}
