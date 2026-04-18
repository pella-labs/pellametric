// Redaction fixtures (re-exported via the workspace package). Used by the
// adversarial recall tests in packages/redact/src/orchestrator.adversarial.test.ts
// and by the privacy assembly gate in tests/privacy/.

export type { CorpusEntry } from "./secrets/corpus";
export { SECRET_CORPUS } from "./secrets/corpus";
