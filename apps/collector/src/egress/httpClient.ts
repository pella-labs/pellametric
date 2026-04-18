// HTTP client with exponential backoff + 4xx-surface.
//
// Wraps fetch so flushOnce stays a simple "single batch" function while this
// layer handles:
//   - exponential backoff w/ jitter for 5xx / network errors
//   - 429 honors Retry-After
//   - 4xx (except 429) surfaces immediately — do NOT retry auth / schema errors
//   - abort-signal propagation for graceful shutdown
//   - optional ingest-only-to hostname enforcement (cert-pinning is Envoy's job,
//     but we refuse to egress to any other host at all per CLAUDE.md §Security)
//
// Tested in httpClient.test.ts.

export interface HttpClientOptions {
  /** Max retry attempts for transient errors (default 5). */
  maxRetries?: number;
  /** Base backoff in ms (default 200). Each retry = base * 2^n + jitter. */
  baseBackoffMs?: number;
  /** Cap on per-retry sleep (default 30_000). */
  maxBackoffMs?: number;
  /** Egress allowlist — if set, reject requests to any other hostname. */
  ingestOnlyTo?: string | null;
  /** For tests. */
  fetchImpl?: typeof fetch;
  /** For tests — deterministic delay. */
  sleepImpl?: (ms: number) => Promise<void>;
  /** Abort cancels retries + in-flight fetches. */
  signal?: AbortSignal;
}

export interface PostResult {
  /** Final HTTP response. Present even on 4xx. */
  response?: Response | undefined;
  /** Network / abort error. */
  error?: Error | undefined;
  /** How many attempts were made (1 = no retry). */
  attempts: number;
  /** Server-supplied Retry-After in seconds (for 429 / 503). */
  retryAfterSeconds: number | null;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * True if the caller should retry this status code. 4xx (except 408, 429)
 * means "don't retry — caller problem". 5xx / network / 408 / 429 means retry.
 */
export function isRetryableStatus(status: number): boolean {
  if (status === 408 || status === 429) return true;
  if (status >= 500 && status < 600) return true;
  return false;
}

export function parseRetryAfter(h: string | null): number | null {
  if (!h) return null;
  const n = Number.parseInt(h, 10);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, n);
}

export function backoffDelayMs(attempt: number, base: number, cap: number): number {
  const exp = Math.min(cap, base * 2 ** attempt);
  // full jitter per AWS Architecture blog — avoids thundering herd.
  return Math.floor(Math.random() * exp);
}

function assertAllowedHost(url: string, allowedHost: string | null): void {
  if (!allowedHost) return;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error(`invalid URL: ${url}`);
  }
  if (u.host !== allowedHost && u.hostname !== allowedHost) {
    throw new Error(`egress denied by BEMATIST_INGEST_ONLY_TO=${allowedHost}: ${u.host}`);
  }
}

/**
 * POST a payload with retry. Returns the final response (including 4xx
 * responses — the caller decides what to do with them), or an error after all
 * retries are exhausted.
 */
export async function postWithRetry(
  url: string,
  init: RequestInit,
  opts: HttpClientOptions = {},
): Promise<PostResult> {
  const maxRetries = opts.maxRetries ?? 5;
  const baseBackoffMs = opts.baseBackoffMs ?? 200;
  const maxBackoffMs = opts.maxBackoffMs ?? 30_000;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const sleepImpl = opts.sleepImpl ?? defaultSleep;

  assertAllowedHost(url, opts.ingestOnlyTo ?? null);

  let attempts = 0;
  let lastErr: Error | undefined;
  let retryAfterSeconds: number | null = null;

  while (attempts <= maxRetries) {
    if (opts.signal?.aborted) {
      return {
        attempts,
        error: new Error("aborted"),
        retryAfterSeconds,
      };
    }
    attempts += 1;
    try {
      const requestInit: RequestInit = { ...init };
      if (opts.signal) requestInit.signal = opts.signal;
      const res = await fetchImpl(url, requestInit);
      // 4xx (except 408/429) → surface immediately, do NOT retry.
      if (!isRetryableStatus(res.status)) {
        return { response: res, attempts, retryAfterSeconds: null };
      }
      // Retryable status.
      const ra = parseRetryAfter(res.headers.get("Retry-After"));
      retryAfterSeconds = ra;
      // If out of retries, hand back the response and let caller decide.
      if (attempts > maxRetries) {
        return { response: res, attempts, retryAfterSeconds: ra };
      }
      const sleep =
        ra != null ? ra * 1000 : backoffDelayMs(attempts - 1, baseBackoffMs, maxBackoffMs);
      await sleepImpl(sleep);
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
      if (attempts > maxRetries) break;
      const sleep = backoffDelayMs(attempts - 1, baseBackoffMs, maxBackoffMs);
      await sleepImpl(sleep);
    }
  }
  return { attempts, error: lastErr, retryAfterSeconds };
}
