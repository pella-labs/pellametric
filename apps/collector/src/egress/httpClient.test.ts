import { expect, test } from "bun:test";
import { backoffDelayMs, isRetryableStatus, parseRetryAfter, postWithRetry } from "./httpClient";

const noSleep = async () => {};

test("isRetryableStatus flags 5xx + 408 + 429", () => {
  expect(isRetryableStatus(500)).toBe(true);
  expect(isRetryableStatus(503)).toBe(true);
  expect(isRetryableStatus(408)).toBe(true);
  expect(isRetryableStatus(429)).toBe(true);
});

test("isRetryableStatus rejects 400/401/403/404/413", () => {
  for (const s of [400, 401, 403, 404, 413]) {
    expect(isRetryableStatus(s)).toBe(false);
  }
});

test("parseRetryAfter returns null for absent/invalid", () => {
  expect(parseRetryAfter(null)).toBeNull();
  expect(parseRetryAfter("nope")).toBeNull();
});

test("parseRetryAfter returns seconds for numeric header", () => {
  expect(parseRetryAfter("7")).toBe(7);
});

test("backoffDelayMs returns an int in [0, cap*2^n]", () => {
  for (const n of [0, 1, 2, 3]) {
    const d = backoffDelayMs(n, 100, 10_000);
    expect(d).toBeGreaterThanOrEqual(0);
    expect(d).toBeLessThanOrEqual(Math.min(10_000, 100 * 2 ** n));
  }
});

test("postWithRetry surfaces 401 immediately (no retry)", async () => {
  let calls = 0;
  const fetchMock = async () => {
    calls += 1;
    return new Response(null, { status: 401 });
  };
  const result = await postWithRetry(
    "http://h.test/v1/events",
    { method: "POST" },
    {
      fetchImpl: fetchMock as unknown as typeof fetch,
      sleepImpl: noSleep,
      maxRetries: 3,
    },
  );
  expect(calls).toBe(1);
  expect(result.attempts).toBe(1);
  expect(result.response?.status).toBe(401);
});

test("postWithRetry surfaces 400 immediately (no retry)", async () => {
  let calls = 0;
  const fetchMock = async () => {
    calls += 1;
    return new Response(JSON.stringify({ error: "schema" }), { status: 400 });
  };
  const result = await postWithRetry(
    "http://h.test/v1/events",
    { method: "POST" },
    {
      fetchImpl: fetchMock as unknown as typeof fetch,
      sleepImpl: noSleep,
      maxRetries: 5,
    },
  );
  expect(calls).toBe(1);
  expect(result.response?.status).toBe(400);
});

test("postWithRetry retries 503 up to maxRetries", async () => {
  let calls = 0;
  const fetchMock = async () => {
    calls += 1;
    return new Response(null, { status: 503 });
  };
  const result = await postWithRetry(
    "http://h.test/v1/events",
    { method: "POST" },
    {
      fetchImpl: fetchMock as unknown as typeof fetch,
      sleepImpl: noSleep,
      maxRetries: 2,
    },
  );
  // initial + 2 retries = 3 calls
  expect(calls).toBe(3);
  expect(result.response?.status).toBe(503);
});

test("postWithRetry succeeds on transient 503 that recovers", async () => {
  let calls = 0;
  const fetchMock = async () => {
    calls += 1;
    if (calls < 3) return new Response(null, { status: 503 });
    return new Response(JSON.stringify({ accepted: 1 }), { status: 202 });
  };
  const result = await postWithRetry(
    "http://h.test/v1/events",
    { method: "POST" },
    {
      fetchImpl: fetchMock as unknown as typeof fetch,
      sleepImpl: noSleep,
      maxRetries: 5,
    },
  );
  expect(calls).toBe(3);
  expect(result.response?.status).toBe(202);
});

test("postWithRetry honors Retry-After on 429", async () => {
  let calls = 0;
  let lastSleep = 0;
  const fetchMock = async () => {
    calls += 1;
    if (calls < 2)
      return new Response(null, {
        status: 429,
        headers: { "Retry-After": "3" },
      });
    return new Response(JSON.stringify({ accepted: 1 }), { status: 202 });
  };
  const sleep = async (ms: number) => {
    lastSleep = ms;
  };
  const result = await postWithRetry(
    "http://h.test/v1/events",
    { method: "POST" },
    {
      fetchImpl: fetchMock as unknown as typeof fetch,
      sleepImpl: sleep,
      maxRetries: 3,
    },
  );
  expect(lastSleep).toBe(3_000);
  expect(result.response?.status).toBe(202);
});

test("postWithRetry retries on network error then recovers", async () => {
  let calls = 0;
  const fetchMock = async () => {
    calls += 1;
    if (calls < 3) throw new Error("ECONNREFUSED");
    return new Response(JSON.stringify({ accepted: 1 }), { status: 202 });
  };
  const result = await postWithRetry(
    "http://h.test/v1/events",
    { method: "POST" },
    {
      fetchImpl: fetchMock as unknown as typeof fetch,
      sleepImpl: noSleep,
      maxRetries: 5,
    },
  );
  expect(calls).toBe(3);
  expect(result.response?.status).toBe(202);
});

test("postWithRetry returns error after exhausting retries on network errors", async () => {
  let calls = 0;
  const fetchMock = async () => {
    calls += 1;
    throw new Error("ECONNREFUSED");
  };
  const result = await postWithRetry(
    "http://h.test/v1/events",
    { method: "POST" },
    {
      fetchImpl: fetchMock as unknown as typeof fetch,
      sleepImpl: noSleep,
      maxRetries: 2,
    },
  );
  expect(calls).toBe(3); // initial + 2 retries
  expect(result.error).toBeDefined();
});

test("postWithRetry respects ingestOnlyTo allowlist", async () => {
  await expect(
    postWithRetry(
      "http://evil.test/v1/events",
      { method: "POST" },
      {
        ingestOnlyTo: "ingest.bematist.dev",
        fetchImpl: (async () => new Response(null)) as unknown as typeof fetch,
        sleepImpl: noSleep,
      },
    ),
  ).rejects.toThrow(/egress denied/);
});

test("postWithRetry allows host that matches ingestOnlyTo", async () => {
  let calls = 0;
  const fetchMock = async () => {
    calls += 1;
    return new Response(JSON.stringify({ accepted: 1 }), { status: 202 });
  };
  const result = await postWithRetry(
    "http://ingest.bematist.dev/v1/events",
    { method: "POST" },
    {
      ingestOnlyTo: "ingest.bematist.dev",
      fetchImpl: fetchMock as unknown as typeof fetch,
      sleepImpl: noSleep,
    },
  );
  expect(calls).toBe(1);
  expect(result.response?.status).toBe(202);
});

test("postWithRetry aborts if signal already aborted", async () => {
  const ac = new AbortController();
  ac.abort();
  const result = await postWithRetry(
    "http://h.test/v1/events",
    { method: "POST" },
    {
      signal: ac.signal,
      fetchImpl: (async () => new Response(null)) as unknown as typeof fetch,
      sleepImpl: noSleep,
    },
  );
  expect(result.error?.message).toBe("aborted");
});
