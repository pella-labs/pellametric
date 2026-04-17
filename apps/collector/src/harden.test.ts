import { expect, test } from "bun:test";
import { harden } from "./harden";

test("harden() does not throw on any supported platform", () => {
  expect(() => harden()).not.toThrow();
});

test("harden() returns a report naming the platform it ran on", () => {
  const report = harden();
  expect(["darwin", "linux", "win32", "freebsd", "openbsd"]).toContain(report.platform);
});

test("harden() on POSIX reports core rlimit intent", () => {
  const report = harden();
  if (report.platform === "darwin" || report.platform === "linux") {
    expect(report.coreRlimitAttempted).toBe(true);
  }
});
