import { Database } from "bun:sqlite";
import { copyFileSync, existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

export interface CopyReadResult {
  db: Database;
  tempDir: string;
  cleanup(): void;
}

/**
 * Copy a SQLite file into a temp dir and open the copy read-only. Cursor holds
 * a writer on the live DB; copy-and-read avoids SQLITE_BUSY and never risks
 * corrupting the source. `readonly: true` enforces query_only at the driver.
 */
export function openReadOnlyCopy(sourcePath: string): CopyReadResult {
  if (!existsSync(sourcePath)) {
    throw new Error(`cursor state db not found: ${sourcePath}`);
  }
  statSync(sourcePath);
  const tempDir = mkdtempSync(join(tmpdir(), "bematist-cursor-"));
  const dest = join(tempDir, basename(sourcePath));
  copyFileSync(sourcePath, dest);
  const db = new Database(dest, { readonly: true, create: false });
  try {
    db.query("PRAGMA schema_version").get();
  } catch (e) {
    try {
      db.close();
    } catch {}
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
    throw new Error(`cursor state db is not a valid sqlite file: ${sourcePath} (${errStr(e)})`);
  }
  return {
    db,
    tempDir,
    cleanup() {
      try {
        db.close();
      } catch {}
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch {}
    },
  };
}

function errStr(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
