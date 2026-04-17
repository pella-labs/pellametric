import { copyFileSync, existsSync, renameSync, writeFileSync } from "node:fs";

/**
 * Atomically write `content` to `path`. If `path` already exists, its prior
 * content is preserved at `${path}.bak` BEFORE the rename but AFTER the new
 * content is successfully staged to a temp file — this ordering means a
 * failed write never clobbers the .bak story.
 *
 * Cross-platform: relies on same-volume rename semantics. Callers should
 * ensure `path` and its directory are on the same filesystem (true for all
 * collector-side users of this function).
 */
export async function atomicWrite(path: string, content: string): Promise<void> {
  const tmp = `${path}.tmp.${process.pid}.${Date.now()}`;
  writeFileSync(tmp, content, "utf8");
  if (existsSync(path)) {
    copyFileSync(path, `${path}.bak`);
  }
  renameSync(tmp, path);
}

/** Minimal unified-diff implementation — good enough for CLI preview, not a library replacement. */
export function unifiedDiff(a: string, b: string): string {
  if (a === b) return "";
  const aLines = a.split("\n");
  const bLines = b.split("\n");
  const out: string[] = [];
  const max = Math.max(aLines.length, bLines.length);
  for (let i = 0; i < max; i++) {
    const l = aLines[i];
    const r = bLines[i];
    if (l === r) continue;
    if (l !== undefined) out.push(`-${l}`);
    if (r !== undefined) out.push(`+${r}`);
  }
  return out.join("\n");
}
