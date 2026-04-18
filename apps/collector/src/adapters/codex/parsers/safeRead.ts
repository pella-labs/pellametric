import { statSync } from "node:fs";
import { open } from "node:fs/promises";

/**
 * Line-oriented reader over arbitrarily large files. No 50 MB silent-drop
 * limit (D17 fix). Returns the new offset so callers can resume tailing
 * without re-reading what they already processed.
 */
export async function readLinesFromOffset(
  path: string,
  offset: number,
): Promise<{ lines: string[]; nextOffset: number }> {
  let size: number;
  try {
    size = statSync(path).size;
  } catch {
    return { lines: [], nextOffset: offset };
  }
  if (offset >= size) return { lines: [], nextOffset: offset };

  const fh = await open(path, "r");
  try {
    const CHUNK = 64 * 1024;
    const buf = Buffer.alloc(CHUNK);
    let pos = offset;
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
    if (residual.length > 0) lines.push(residual);
    return { lines, nextOffset: size };
  } finally {
    await fh.close();
  }
}
