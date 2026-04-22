import type { IngestPayload, IngestPrompt, IngestResponse, IngestSession } from "@pella/shared";

export const COLLECTOR_VERSION = "0.0.2";
const BATCH = 200;

export interface UploadOptions {
  url: string;
  token: string;
  source: "claude" | "codex";
  sessions: IngestSession[];
  prompts: IngestPrompt[];
  responses: IngestResponse[];
  /** Logger hook — defaults to console.log. Tests pass a no-op. */
  log?: (msg: string) => void;
  /** Injected for tests. */
  fetchImpl?: typeof fetch;
}

export interface UploadResult {
  inserted: number;
  promptsInserted: number;
  responsesInserted: number;
  rejected: number;
  batches: number;
  httpErrors: number;
}

/**
 * POST sessions + prompts to /api/ingest in chunks of 200. Returns
 * aggregate counts. Keeps the same wire contract as the legacy one-
 * shot — the server upserts on (userId, source, externalSessionId),
 * which makes re-uploads of a growing session idempotent.
 */
export async function uploadBatch(opts: UploadOptions): Promise<UploadResult> {
  const log = opts.log ?? ((m: string) => console.log(m));
  const fetchImpl = opts.fetchImpl ?? fetch;
  const result: UploadResult = { inserted: 0, promptsInserted: 0, responsesInserted: 0, rejected: 0, batches: 0, httpErrors: 0 };
  if (opts.sessions.length === 0) {
    log(`[${opts.source}] no sessions`);
    return result;
  }

  const promptsBySid = new Map<string, IngestPrompt[]>();
  for (const p of opts.prompts) {
    const arr = promptsBySid.get(p.externalSessionId);
    if (arr) arr.push(p);
    else promptsBySid.set(p.externalSessionId, [p]);
  }
  const responsesBySid = new Map<string, IngestResponse[]>();
  for (const r of opts.responses) {
    const arr = responsesBySid.get(r.externalSessionId);
    if (arr) arr.push(r);
    else responsesBySid.set(r.externalSessionId, [r]);
  }

  for (let i = 0; i < opts.sessions.length; i += BATCH) {
    const chunk = opts.sessions.slice(i, i + BATCH);
    const chunkPrompts: IngestPrompt[] = [];
    const chunkResponses: IngestResponse[] = [];
    for (const sess of chunk) {
      const pl = promptsBySid.get(sess.externalSessionId);
      if (pl) chunkPrompts.push(...pl);
      const rl = responsesBySid.get(sess.externalSessionId);
      if (rl) chunkResponses.push(...rl);
    }
    const payload: IngestPayload = {
      source: opts.source,
      collectorVersion: COLLECTOR_VERSION,
      sessions: chunk,
      prompts: chunkPrompts,
      responses: chunkResponses,
    };
    try {
      const r = await fetchImpl(`${opts.url}/api/ingest`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${opts.token}` },
        body: JSON.stringify(payload),
      });
      const j: any = await r.json().catch(() => ({}));
      result.batches++;
      if (!r.ok) {
        result.httpErrors++;
        log(`[${opts.source}] batch ${i}: HTTP ${r.status} ${JSON.stringify(j)}`);
        continue;
      }
      result.inserted += j.inserted || 0;
      result.promptsInserted += j.promptsInserted || 0;
      result.responsesInserted += j.responsesInserted || 0;
      result.rejected += j.rejected?.length || 0;
      log(
        `[${opts.source}] batch ${i}-${i + chunk.length}: inserted ${j.inserted}, prompts ${j.promptsInserted || 0}, responses ${j.responsesInserted || 0}, rejected ${j.rejected?.length || 0}`,
      );
    } catch (e) {
      result.httpErrors++;
      log(`[${opts.source}] batch ${i}: fetch failed — ${(e as Error).message}`);
    }
  }
  log(
    `[${opts.source}] total inserted ${result.inserted}, prompts ${result.promptsInserted}, responses ${result.responsesInserted}, rejected ${result.rejected}`,
  );
  return result;
}
