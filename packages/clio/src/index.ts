// @bematist/clio — on-device 4-stage prompt pipeline (contract 06, D27).
//
// Stages:
//   1. Redact   — `runRedact` / `builtinRedactStage` (uses `@bematist/redact`)
//   2. Abstract — `runAbstract` / MCP / Ollama (NEVER cloud)
//   3. Verify   — `runVerify` / `builtinVerifier` / `LLMVerifier`
//   4. Embed    — `XenovaEmbedder` (default) / `HashingEmbedder` (test-only)
//
// Orchestrators:
//   - `runPipeline(input, deps)` → `PipelineOutput`
//   - `attachPromptRecord(event, rawPromptText, args)` → adapter helper
//
// MERGE BLOCKER (CLAUDE.md §Testing Rules / D27):
//   - 50-prompt adversarial fixture in `packages/fixtures/clio/identifying/`
//   - Verifier recall ≥ 95% — enforced by `verify.recall.test.ts`
//   - E2E pipeline test asserts raw prompt never reaches embed stage

export type {
  AbstractProvider,
  AbstractProviderId,
  AbstractRequest,
  AbstractResult,
  AbstractStageResult,
  ProviderHealth,
} from "./abstract";
export {
  CloudProviderRefusedError,
  MCPAbstractProvider,
  normalizeAbstract,
  OllamaAbstractProvider,
  runAbstract,
} from "./abstract";
export type { Embedder, EmbedRequest, EmbedResult, XenovaEmbedderOpts } from "./embed";
export {
  __resetXenovaForTest,
  abstractCacheKey,
  HashingEmbedder,
  LRUCache,
  XenovaEmbedder,
} from "./embed";
export { assertNoForbiddenFields, ForbiddenFieldError, findForbiddenField } from "./forbidden";
export type { PipelineDeps, PipelineInput, PipelineOutput } from "./pipeline";
export { attachPromptRecord, runPipeline } from "./pipeline";
export type { RedactStageResult } from "./redact";
export { builtinRedactStage, runRedact } from "./redact";
export type { ForbiddenField, PromptRecord, RedactionReport, Tier } from "./types";
export { CLIO_PIPELINE_VERSION, FORBIDDEN_FIELDS } from "./types";
export type { Verifier, VerifyDecision, VerifyInput, VerifyResult } from "./verify";
export {
  builtinVerifier,
  composeVerifiers,
  LLMVerifier,
  runVerify,
} from "./verify";
