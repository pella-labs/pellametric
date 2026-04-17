// Small HTTP helpers shared across ingest (avoids bringing in a client lib).
// Extracted in Sprint-1 Phase 4 so the ClickHouse ping logic is reusable from
// `clickhouse.ts` in addition to `server.ts` readyz checks.

const DEFAULT_TIMEOUT_MS = 2000;

export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/**
 * HTTP GET `${urlStr}/ping` with a small timeout. Returns true on 2xx.
 * Undefined URL → false (dev-mode treated as not-configured, not failing).
 */
export async function pingClickHouse(
  urlStr: string | undefined,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<boolean> {
  if (!urlStr) return false;
  try {
    const res = await withTimeout(
      fetch(new URL("/ping", urlStr).toString(), { method: "GET" }),
      timeoutMs,
    );
    return res.ok;
  } catch {
    return false;
  }
}
