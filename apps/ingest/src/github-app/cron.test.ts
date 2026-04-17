import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { startReconciliationCron } from "./cron";

let origRandom: () => number;

beforeEach(() => {
  origRandom = Math.random;
  // Force zero jitter (deterministic scheduling).
  Math.random = () => 0.5;
});
afterEach(() => {
  Math.random = origRandom;
});

describe("startReconciliationCron", () => {
  test("runs at interval (≈) — advance timers past interval+jitter → run invoked once", async () => {
    let runs = 0;
    const interval = 1_000;
    const jitterMs = 0;
    const handle = startReconciliationCron({
      interval,
      jitterMs,
      run: () => {
        runs++;
      },
    });
    // No runs yet.
    expect(runs).toBe(0);
    // Wait just past the interval.
    await new Promise((r) => setTimeout(r, interval + 30));
    expect(runs).toBeGreaterThanOrEqual(1);
    handle.stop();
  });

  test("handle.stop() halts further ticks", async () => {
    let runs = 0;
    const handle = startReconciliationCron({
      interval: 30,
      jitterMs: 0,
      run: () => {
        runs++;
      },
    });
    await new Promise((r) => setTimeout(r, 60));
    handle.stop();
    const at = runs;
    await new Promise((r) => setTimeout(r, 100));
    expect(runs).toBe(at);
  });

  test("swallows errors via onError", async () => {
    const errs: unknown[] = [];
    const handle = startReconciliationCron({
      interval: 20,
      jitterMs: 0,
      run: () => {
        throw new Error("kaboom");
      },
      onError: (e) => errs.push(e),
    });
    await new Promise((r) => setTimeout(r, 60));
    handle.stop();
    expect(errs.length).toBeGreaterThanOrEqual(1);
    expect((errs[0] as Error).message).toBe("kaboom");
  });
});
