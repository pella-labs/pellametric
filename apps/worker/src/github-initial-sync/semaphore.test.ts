// PRD §11.2 + §13 (test #7) — ≤5 concurrent initial syncs per worker node.
//
// The semaphore is LOCAL to the worker process (not distributed Redis lock)
// because each worker node is independently bound to the 5-slot cap per PRD.
// Production scaling adds more worker nodes, not more slots per node.

import { describe, expect, test } from "bun:test";
import { createLocalSemaphore } from "./semaphore";

describe("github-initial-sync/semaphore", () => {
  test("allows up to N concurrent holders; queues the rest", async () => {
    const sem = createLocalSemaphore(2);
    const acquired: number[] = [];
    const released: number[] = [];

    const run = async (id: number, holdMs: number) => {
      const release = await sem.acquire();
      acquired.push(id);
      await new Promise((r) => setTimeout(r, holdMs));
      released.push(id);
      release();
    };

    // Three concurrent workers, cap=2. At t=0 only 2 hold; third waits.
    const p1 = run(1, 40);
    const p2 = run(2, 40);
    // give the first two a microtask to acquire before launching the third
    await new Promise((r) => setTimeout(r, 5));
    const p3 = run(3, 10);

    // At this point acquired should have [1, 2] only.
    expect(acquired.sort()).toEqual([1, 2]);

    await Promise.all([p1, p2, p3]);

    // After everything released, all three should have run.
    expect(acquired.sort()).toEqual([1, 2, 3]);
    expect(released.sort()).toEqual([1, 2, 3]);
  });

  test("7 concurrent acquires → never more than 5 overlap (PRD cap)", async () => {
    const CAP = 5;
    const sem = createLocalSemaphore(CAP);
    let current = 0;
    let peak = 0;
    const timeline: Array<{ id: number; event: "start" | "end"; at: number }> = [];
    const t0 = Date.now();

    const run = async (id: number) => {
      const release = await sem.acquire();
      current += 1;
      peak = Math.max(peak, current);
      timeline.push({ id, event: "start", at: Date.now() - t0 });
      // Hold long enough that multiple would overlap if uncapped.
      await new Promise((r) => setTimeout(r, 20));
      timeline.push({ id, event: "end", at: Date.now() - t0 });
      current -= 1;
      release();
    };

    await Promise.all(Array.from({ length: 7 }, (_, i) => run(i)));

    expect(peak).toBeLessThanOrEqual(CAP);
    // Evidence for the PRD §13 test #7 concurrency-cap assertion: we log the
    // timeline below — at any moment ≤5 "start" events with no matching
    // "end" in between.
    let concurrent = 0;
    let maxConcurrent = 0;
    for (const evt of timeline) {
      if (evt.event === "start") concurrent += 1;
      else concurrent -= 1;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
    }
    expect(maxConcurrent).toBeLessThanOrEqual(CAP);
  });

  test("release is idempotent — double-release does not inflate slot count", async () => {
    const sem = createLocalSemaphore(1);
    const release = await sem.acquire();
    release();
    // Call again — must be a no-op, NOT add an extra slot.
    release();

    // We should still only be able to hold ONE at a time.
    const rA = await sem.acquire();
    let acquired2 = false;
    const p = sem.acquire().then((rB) => {
      acquired2 = true;
      rB();
    });
    // A tiny tick so the queued acquirer gets a chance to run if it could.
    await new Promise((r) => setTimeout(r, 5));
    expect(acquired2).toBe(false);
    rA();
    await p;
    expect(acquired2).toBe(true);
  });
});
