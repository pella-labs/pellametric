import { createHash } from "node:crypto";
import type { EmbedProvider } from "./types";

/**
 * Cache key shape: `sha256(text + provider.id + model + dim)`.
 * Per contract 05 §Cache invariant 3: includes provider.id + model + dim
 * so swapping providers can't return wrong-dim vectors.
 */
export function cacheKey(
  text: string,
  provider: Pick<EmbedProvider, "id" | "model" | "dim">,
): string {
  return createHash("sha256")
    .update(`${provider.id}\0${provider.model}\0${provider.dim}\0${text}`)
    .digest("hex");
}
