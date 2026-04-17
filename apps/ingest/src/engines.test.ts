// Phase 1 CI assertion (PRD §541–585 test #12):
// Root package.json must pin engines.bun to >=1.3.4.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("engines.bun pin", () => {
  test("Bun.version runtime is >= 1.3.4", () => {
    // Belt-and-suspenders: in addition to checking the pin in package.json,
    // assert the actual runtime. Sprint-1 follow-up A requires Bun 1.3.12 for
    // Bun.redis; anything below 1.3.4 blocks the real dedup adapter.
    const m = Bun.version.match(/^(\d+)\.(\d+)\.(\d+)/);
    expect(m).not.toBeNull();
    const major = Number(m?.[1]);
    const minor = Number(m?.[2]);
    const patch = Number(m?.[3]);
    const ok =
      major > 1 || (major === 1 && minor > 3) || (major === 1 && minor === 3 && patch >= 4);
    expect(ok).toBe(true);
  });

  test("root package.json has engines.bun >= 1.3.4", () => {
    // apps/ingest/src -> repo root
    const root = resolve(import.meta.dir, "../../..");
    const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
      engines?: { bun?: string };
    };
    const pin = pkg.engines?.bun;
    expect(pin).toBeDefined();
    // Accept ">=1.3.X" where X >= 4, or higher major/minor.
    const match = pin?.match(/^>=\s*(\d+)\.(\d+)\.(\d+)$/);
    expect(match).not.toBeNull();
    const major = Number(match?.[1]);
    const minor = Number(match?.[2]);
    const patch = Number(match?.[3]);
    const ok =
      major > 1 || (major === 1 && minor > 3) || (major === 1 && minor === 3 && patch >= 4);
    expect(ok).toBe(true);
  });

  test("packages/schema pins @clickhouse/client >= 1.18.2", () => {
    const root = resolve(import.meta.dir, "../../..");
    const pkg = JSON.parse(readFileSync(resolve(root, "packages/schema/package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
    };
    const pin = pkg.dependencies?.["@clickhouse/client"];
    expect(pin).toBeDefined();
    // caret or tilde range starting at 1.18.2+
    const match = pin?.match(/^[\^~]?(\d+)\.(\d+)\.(\d+)/);
    expect(match).not.toBeNull();
    const major = Number(match?.[1]);
    const minor = Number(match?.[2]);
    const patch = Number(match?.[3]);
    const ok =
      major > 1 || (major === 1 && minor > 18) || (major === 1 && minor === 18 && patch >= 2);
    expect(ok).toBe(true);
  });
});
