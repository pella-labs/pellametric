import { statSync } from "node:fs";
import { open } from "node:fs/promises";

/**
 * Read newline-delimited lines from `offset` to EOF. No silent-drop size cap
 * (D17 P0 fix — mirrors `apps/collector/src/adapters/claude-code/parsers/safeRead.ts`).
 * Returns the new offset so callers can resume.
 *
 * Continue.dev streams are append-only JSONL; we track a per-stream byte
 * offset in the adapter cursor. Rotation (if Continue ever introduces it)
 * shrinks the file — detected via `size < offset`; we reset offset to 0.
 */
export async function readLinesFromOffset(
  path: string,
  offset: number,
): Promise<{ lines: string[]; nextOffset: number; rotated: boolean }> {
  let size: number;
  try {
    size = statSync(path).size;
  } catch {
    return { lines: [], nextOffset: offset, rotated: false };
  }

  let startOffset = offset;
  let rotated = false;
  if (offset > size) {
    startOffset = 0;
    rotated = true;
  }
  if (startOffset >= size) return { lines: [], nextOffset: startOffset, rotated };

  const fh = await open(path, "r");
  try {
    const CHUNK = 64 * 1024;
    const buf = Buffer.alloc(CHUNK);
    let pos = startOffset;
    let residual = "";
    const lines: string[] = [];

    while (pos < size) {
      const { bytesRead } = await fh.read(buf, 0, Math.min(CHUNK, size - pos), pos);
      if (bytesRead === 0) break;
      const chunk = residual + buf.toString("utf8", 0, bytesRead);
      const parts = chunk.split("\n");
      residual = parts.pop() ?? "";
      for (const p of parts) {
        if (p.length > 0) lines.push(p);
      }
      pos += bytesRead;
    }
    // Don't include the final residual: it may be a half-written line that
    // the upstream writer will complete on the next poll. Advance the offset
    // only up to the last newline we consumed.
    const consumed = pos - residual.length;
    return { lines, nextOffset: consumed, rotated };
  } finally {
    await fh.close();
  }
}
