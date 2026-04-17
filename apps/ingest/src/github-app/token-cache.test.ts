import { describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { createInMemoryInstallationTokenCache, getInstallationToken } from "./token-cache";

function genKey(): string {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return privateKey.export({ format: "pem", type: "pkcs8" }).toString();
}

function mockFetch(responses: Array<{ status: number; body: Record<string, unknown> }>): {
  fetchFn: typeof fetch;
  calls: number;
} {
  let calls = 0;
  const fetchFn: typeof fetch = (async () => {
    const idx = Math.min(calls, responses.length - 1);
    const r = responses[idx];
    if (!r) throw new Error("mockFetch: no response configured");
    calls++;
    return new Response(JSON.stringify(r.body), { status: r.status });
  }) as unknown as typeof fetch;
  const wrap = {
    fetchFn,
    get calls() {
      return calls;
    },
  };
  return wrap as unknown as { fetchFn: typeof fetch; calls: number };
}

describe("github-app/token-cache", () => {
  test("cache hit avoids HTTP call", async () => {
    const cache = createInMemoryInstallationTokenCache();
    cache.set("inst-1", "preexisting-token", 60_000);
    const mock = mockFetch([]);
    const token = await getInstallationToken({
      installationId: "inst-1",
      appId: 1,
      privateKeyPem: genKey(),
      cache,
      fetchFn: mock.fetchFn,
    });
    expect(token).toBe("preexisting-token");
    expect(mock.calls).toBe(0);
  });

  test("cache miss mints JWT, POSTs, caches", async () => {
    const cache = createInMemoryInstallationTokenCache();
    const fakeNow = 1_700_000_000_000;
    const expiresAt = new Date(fakeNow + 60 * 60 * 1000).toISOString(); // +1h
    const mock = mockFetch([
      { status: 201, body: { token: "fresh-token", expires_at: expiresAt } },
    ]);
    const token = await getInstallationToken({
      installationId: "inst-2",
      appId: 1,
      privateKeyPem: genKey(),
      cache,
      fetchFn: mock.fetchFn,
      now: () => fakeNow,
    });
    expect(token).toBe("fresh-token");
    expect(mock.calls).toBe(1);
    // Immediate subsequent call hits cache.
    const again = await getInstallationToken({
      installationId: "inst-2",
      appId: 1,
      privateKeyPem: genKey(),
      cache,
      fetchFn: mock.fetchFn,
      now: () => fakeNow,
    });
    expect(again).toBe("fresh-token");
    expect(mock.calls).toBe(1);
  });

  test("expired cache entry triggers refresh", async () => {
    let now = 1_000_000;
    const cache = createInMemoryInstallationTokenCache({ clock: () => now });
    cache.set("inst-3", "old", 1_000); // expires quickly
    now += 5_000;
    const mock = mockFetch([
      {
        status: 201,
        body: { token: "new", expires_at: new Date(now + 3600_000).toISOString() },
      },
    ]);
    const token = await getInstallationToken({
      installationId: "inst-3",
      appId: 1,
      privateKeyPem: genKey(),
      cache,
      fetchFn: mock.fetchFn,
      now: () => now,
    });
    expect(token).toBe("new");
    expect(mock.calls).toBe(1);
  });
});
