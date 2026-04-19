import { SlideShell } from "../components/slide-shell";

export function Slide10TwoReaders({ totalPages }: { totalPages: number }) {
  return (
    <SlideShell sectionLabel="08 / AUDIENCE" pageNumber={10} totalPages={totalPages}>
      <div className="eyebrow">08 / WHO IT SERVES</div>
      <h2 className="title" style={{ fontSize: 72 }}>
        Two readers. One <em>data set</em>.
      </h2>
      <p className="body-text" style={{ marginTop: 20, fontSize: 24 }}>
        Different views, separated by{" "}
        <span className="accent">privacy guarantees that can be proven</span>, not just promised.
        Bematist is the instrument they both need.
      </p>

      <div className="readers">
        <div className="reader-col">
          <span className="reader-role">The Leader</span>
          <h3>VP of Engineering, CTO, compliance officer.</h3>
          <p className="muted" style={{ fontSize: "var(--t-body)", margin: 0, lineHeight: 1.4 }}>
            Needs defensible spend in a board review or audit, or a results council.
          </p>
          <div className="reader-sees">Sees</div>
          <ul className="reader-list">
            <li>Spend accountability</li>
            <li>Impact visibility</li>
            <li>Performance visibility</li>
            <li>Operational clarity</li>
          </ul>
        </div>
        <div className="reader-col">
          <span className="reader-role">The Engineer</span>
          <h3>Senior. They could be more effective with this, but have no time to see.</h3>
          <p className="muted" style={{ fontSize: "var(--t-body)", margin: 0, lineHeight: 1.4 }}>
            Wants to know what's working — without a manager reading over their shoulder.
          </p>
          <div className="reader-sees">Sees</div>
          <ul className="reader-list">
            <li>Workflow efficiency</li>
            <li>Self-reference</li>
            <li>Twin finder — peers solving the same thing</li>
            <li>Private by default</li>
          </ul>
        </div>
      </div>
    </SlideShell>
  );
}
