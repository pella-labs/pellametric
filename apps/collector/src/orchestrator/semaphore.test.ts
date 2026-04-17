import { expect, test } from "bun:test";
import { Semaphore } from "./semaphore";

test("acquire is immediate when under cap", async () => {
  const s = new Semaphore(2);
  await s.acquire();
  await s.acquire();
  expect(s.activeCount).toBe(2);
  s.release();
  s.release();
  expect(s.activeCount).toBe(0);
});

test("acquire blocks when cap reached and resumes on release", async () => {
  const s = new Semaphore(1);
  await s.acquire();
  let resolved = false;
  const p = s.acquire().then(() => {
    resolved = true;
  });
  // Wait a tick — blocked acquire should still be pending.
  await new Promise((r) => setTimeout(r, 5));
  expect(resolved).toBe(false);
  s.release();
  await p;
  expect(resolved).toBe(true);
});

test("release without acquire throws", () => {
  const s = new Semaphore(1);
  expect(() => s.release()).toThrow();
});
