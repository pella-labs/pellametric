import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

export type ProviderName = "github" | "gitlab";

export interface RepoInfo {
  /** Backwards-compatible "owner" — for GitLab this is the full ownerPath (may include slashes). */
  owner: string;
  repo: string;
  /** Provider host detected from the remote URL. Defaults to 'github' when omitted. */
  provider?: ProviderName;
}

export type RepoCache = Map<string, RepoInfo | null>;

export function makeRepoCache(): RepoCache {
  return new Map();
}

/**
 * Self-hosted GitLab support: respect a comma-separated `PELLA_GITLAB_HOSTS`
 * env var. `gitlab.com` is always recognized.
 */
function gitlabHosts(): Set<string> {
  const set = new Set<string>(["gitlab.com"]);
  const extra = process.env.PELLA_GITLAB_HOSTS;
  if (extra) for (const h of extra.split(",").map(s => s.trim()).filter(Boolean)) set.add(h);
  return set;
}

/**
 * Parse any git remote URL → { provider, owner, repo } or null.
 *
 * Handles:
 *   git@host:path.git
 *   ssh://git@host/path.git
 *   https://host/path.git
 *
 * For GitHub: owner = first segment, repo = second.
 * For GitLab: owner = everything except the last segment (preserves subgroups), repo = last.
 */
export function parseRemote(url: string): RepoInfo | null {
  // Normalize: strip .git suffix, trim trailing slashes.
  const stripped = url.replace(/\.git$/, "").replace(/\/+$/, "");

  // Split into host + path. Three URL forms:
  //   git@HOST:PATH
  //   ssh://git@HOST/PATH
  //   https://HOST/PATH
  let host: string | null = null;
  let p: string | null = null;

  let m = stripped.match(/^git@([^:]+):(.+)$/);
  if (m) { host = m[1]; p = m[2]; }
  if (!host) {
    m = stripped.match(/^(?:ssh|https?):\/\/(?:[^@/]+@)?([^/]+)\/(.+)$/);
    if (m) { host = m[1]; p = m[2]; }
  }
  if (!host || !p) return null;

  const segments = p.split("/").filter(Boolean);
  if (segments.length < 2) return null;

  const gitlabSet = gitlabHosts();
  const isGithub = host === "github.com";
  const isGitlab = gitlabSet.has(host);
  if (!isGithub && !isGitlab) return null;

  const repo = segments[segments.length - 1];
  const owner = segments.slice(0, -1).join("/");
  if (!owner || !repo) return null;

  return { provider: isGithub ? "github" : "gitlab", owner, repo };
}

/** Back-compat alias — pre-multi-provider code calls this name. */
export const parseGithubRemote = parseRemote;

/**
 * Resolve a working-directory path to repo info via `git remote get-url origin`.
 * Returns null for cwds that aren't under a git repo, or whose origin host
 * isn't a recognized provider host.
 */
export function resolveRepo(cwd: string, cache: RepoCache): RepoInfo | null {
  if (!cwd) return null;
  if (cache.has(cwd)) return cache.get(cwd) ?? null;
  const trimmed = cwd.replace(/\/\.claude\/worktrees\/agent-[^/]+.*$/, "");
  let cur = trimmed;
  let root: string | null = null;
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(cur, ".git"))) {
      root = cur;
      break;
    }
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  if (!root) {
    cache.set(cwd, null);
    return null;
  }
  try {
    // H8 fix: execFileSync to keep `root` out of the shell. The previous
    // template-string into a shell allowed a hostile cwd containing $(…),
    // backticks, or quoting to inject commands.
    const url = execFileSync("git", ["-C", root, "remote", "get-url", "origin"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const info = parseRemote(url);
    cache.set(cwd, info);
    return info;
  } catch {
    cache.set(cwd, null);
    return null;
  }
}

/**
 * Resolve current git branch for cwd. Returns null if outside a repo or in a
 * detached HEAD. Insights revamp P9.
 */
export function resolveBranch(cwd: string): string | null {
  if (!cwd) return null;
  try {
    // H8 fix: execFileSync — cwd is untrusted.
    const out = execFileSync("git", ["-C", cwd, "rev-parse", "--abbrev-ref", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (!out || out === "HEAD") return null;
    return out;
  } catch {
    return null;
  }
}

/**
 * Convert a RepoInfo into the canonical `owner/name` form used by `session_event.cwdResolvedRepo`.
 */
export function repoToCwdResolved(info: RepoInfo | null): string | null {
  if (!info) return null;
  return `${info.owner}/${info.repo}`;
}
