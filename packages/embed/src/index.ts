// D2-05 cache layer
export {
  type CachedEntry,
  type EmbedCache,
  fromCached,
  InMemoryEmbedCache,
  toCached,
} from "./cache";
export { cacheKey } from "./cacheKey";
export { BudgetExceededError, CostGuard, type CostGuardOpts } from "./cost";
export { type EmbedCachedOpts, embedCached } from "./embedCached";
export { PgEmbedCache, type PgLike } from "./pgCache";
export { OllamaEmbedder } from "./providers/ollama";
export { OpenAIEmbedder } from "./providers/openai";
export { VoyageEmbedder } from "./providers/voyage";
export { XenovaEmbedder } from "./providers/xenova";
export { RedisEmbedCache, type RedisLike } from "./redisCache";
export { type ResolveOpts, resolveProvider } from "./resolve";
export type {
  EmbedProvider,
  EmbedPurpose,
  EmbedRequest,
  EmbedResult,
  ProviderHealth,
  ProviderId,
} from "./types";
export { NoEmbedProviderError } from "./types";
