import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { resolveGitContext } from "./git-context";

function makeRepo(): { dir: string; sha: string } {
  const dir = mkdtempSync(join(tmpdir(), "bematist-git-ctx-"));
  execSync("git init -q -b main", { cwd: dir });
  // Minimal identity so commit doesn't fail on a bare box.
  execSync('git config user.email "t@t"', { cwd: dir });
  execSync('git config user.name "t"', { cwd: dir });
  writeFileSync(join(dir, "README"), "hi\n");
  execSync("git add .", { cwd: dir });
  execSync('git commit -q -m "init"', { cwd: dir });
  const sha = execSync("git rev-parse HEAD", { cwd: dir }).toString().trim();
  return { dir, sha };
}

describe("resolveGitContext", () => {
  test("returns head_sha and repo_root for a real repo", async () => {
    const { dir, sha } = makeRepo();
    const ctx = await resolveGitContext(dir);
    expect(ctx.head_sha).toBe(sha);
    // macOS maps /tmp to /private/tmp, so the resolved path may be prefixed.
    expect(ctx.repo_root).toMatch(new RegExp(`${dir.replace(/^\/private/, "")}$`));
  });

  test("resolves identically from a subdirectory of the worktree", async () => {
    const { dir, sha } = makeRepo();
    const sub = join(dir, "nested/deep");
    mkdirSync(sub, { recursive: true });
    const ctx = await resolveGitContext(sub);
    expect(ctx.head_sha).toBe(sha);
  });

  test("returns nulls for a non-repo cwd", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bematist-no-repo-"));
    const ctx = await resolveGitContext(dir);
    expect(ctx.head_sha).toBeNull();
    expect(ctx.repo_root).toBeNull();
  });

  test("returns nulls for a missing directory", async () => {
    const ctx = await resolveGitContext("/tmp/bematist-does-not-exist-xyzzy");
    expect(ctx.head_sha).toBeNull();
    expect(ctx.repo_root).toBeNull();
  });

  test("returns nulls for empty cwd", async () => {
    const ctx = await resolveGitContext("");
    expect(ctx.head_sha).toBeNull();
  });
});
