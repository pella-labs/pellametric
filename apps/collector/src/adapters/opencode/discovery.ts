import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * OpenCode stores sessions in one of two shapes depending on version:
 *
 *  - **Post-v1.2**: a single SQLite database at
 *    `<dataDir>/storage.sqlite` (Drizzle-managed).
 *  - **Pre-v1.2**: sharded JSON files under
 *    `<dataDir>/storage/session/<sessionId>/...`.
 *
 * The adapter supports post-v1.2 only. Pre-v1.2 sessions are skipped with a
 * warn log + a counter entry. The `opencode/issues/13654` migration bug leaves
 * some installs with both shapes present on disk; detection covers both.
 *
 * Directory lookup: OPENCODE_DATA_DIR > XDG_DATA_HOME/opencode >
 * ~/.local/share/opencode (Linux default) > ~/Library/Application
 * Support/opencode (macOS).
 */
export interface DiscoverySources {
  dataDir: string;
  dataDirExists: boolean;
  /** Post-v1.2 DB path. May not exist. */
  sqlitePath: string;
  sqliteExists: boolean;
  /** Pre-v1.2 sharded session root. May not exist. */
  legacyDir: string;
  legacyDirExists: boolean;
}

export function discoverSources(): DiscoverySources {
  const dataDir = resolveDataDir();
  const sqlitePath = join(dataDir, "storage.sqlite");
  const legacyDir = join(dataDir, "storage", "session");
  return {
    dataDir,
    dataDirExists: isDir(dataDir),
    sqlitePath,
    sqliteExists: isFile(sqlitePath),
    legacyDir,
    legacyDirExists: isDir(legacyDir),
  };
}

function resolveDataDir(): string {
  if (process.env.OPENCODE_DATA_DIR) return process.env.OPENCODE_DATA_DIR;
  if (process.env.XDG_DATA_HOME) return join(process.env.XDG_DATA_HOME, "opencode");
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support", "opencode");
  }
  return join(homedir(), ".local", "share", "opencode");
}

function isDir(p: string): boolean {
  try {
    return existsSync(p) && statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function isFile(p: string): boolean {
  try {
    return existsSync(p) && statSync(p).isFile();
  } catch {
    return false;
  }
}
