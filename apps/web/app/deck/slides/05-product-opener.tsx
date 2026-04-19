import { RingsBg } from "../components/rings-bg";

export function Slide05ProductOpener({ totalPages }: { totalPages: number }) {
  return (
    <div className="slide opener">
      <RingsBg
        outer="AI SPEND · GIT OUTCOMES · ACCEPTED EDITS · MERGED PRS · VELOCITY · AI SPEND · GIT OUTCOMES · ACCEPTED EDITS · MERGED PRS · VELOCITY · "
        inner="CLAUDE CODE · CURSOR · CODEX · CONTINUE · OPENCODE · VS CODE · CLAUDE CODE · CURSOR · CODEX · CONTINUE · OPENCODE · VS CODE · "
      />
      <div className="sys" style={{ marginBottom: 24 }}>
        04 / THE PRODUCT
      </div>
      <div className="num">04</div>
      <h2 className="big-title">
        Three critical <em>questions</em>.
      </h2>
      <p className="sub">
        Every engineering leader is asking the same three things about AI. Nobody can answer them.
        We built the instrument that can.
      </p>
      <div className="pagenum-left">bematist.dev</div>
      <div className="pagenum">
        05 <span className="total">/ {String(totalPages).padStart(2, "0")}</span>
      </div>
    </div>
  );
}
