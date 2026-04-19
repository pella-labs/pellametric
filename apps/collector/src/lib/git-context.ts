import { spawn } from "node:child_process";

export interface GitContext {
  repo_root: string | null;
  head_sha: string | null;
}

/**
 * Resolve HEAD SHA and repo root for a working directory by spawning git.
 *
 * Graceful by design — every failure mode (missing git binary, non-repo cwd,
 * missing directory, detached-HEAD weirdness) returns `{ null, null }` so
 * callers can silently skip attribution on this session and keep emitting
 * events. Attribution is a nice-to-have, never a gate on data capture.
 *
 * Callers are expected to memoize the result per (session_id, cwd) because
 * spawning is ~5–20ms and Claude Code polls active sessions often.
 */
export async function resolveGitContext(cwd: string): Promise<GitContext> {
  if (!cwd || typeof cwd !== "string") return { repo_root: null, head_sha: null };
  const [head_sha, repo_root] = await Promise.all([
    runGit(cwd, ["rev-parse", "HEAD"]),
    runGit(cwd, ["rev-parse", "--show-toplevel"]),
  ]);
  return {
    head_sha: head_sha && /^[0-9a-f]{40}$/i.test(head_sha) ? head_sha : null,
    repo_root,
  };
}

function runGit(cwd: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    let proc: ReturnType<typeof spawn>;
    try {
      proc = spawn("git", ["-C", cwd, ...args], {
        stdio: ["ignore", "pipe", "ignore"],
      });
    } catch {
      return resolve(null);
    }
    let out = "";
    let settled = false;
    const done = (v: string | null) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };
    proc.stdout?.setEncoding("utf8");
    proc.stdout?.on("data", (d: string) => {
      out += d;
    });
    proc.on("error", () => done(null));
    proc.on("close", (code) => {
      if (code !== 0) return done(null);
      const v = out.trim();
      done(v.length > 0 ? v : null);
    });
    // Belt-and-suspenders timeout: git on a pathological repo shouldn't hang
    // the collector poll loop. 2s is generous for rev-parse.
    setTimeout(() => {
      try {
        proc.kill("SIGTERM");
      } catch {
        // ignore
      }
      done(null);
    }, 2000);
  });
}
