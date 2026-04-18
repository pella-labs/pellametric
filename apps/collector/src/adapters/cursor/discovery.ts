import { existsSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";

export interface DiscoverySources {
  dbPath: string;
  dbExists: boolean;
}

export function cursorStateDbPath(): string {
  if (process.env.CURSOR_STATE_DB) return process.env.CURSOR_STATE_DB;
  const home = homedir();
  const plat = platform();
  if (plat === "darwin") {
    return join(
      home,
      "Library",
      "Application Support",
      "Cursor",
      "User",
      "globalStorage",
      "state.vscdb",
    );
  }
  if (plat === "win32") {
    const appData = process.env.APPDATA || join(home, "AppData", "Roaming");
    return join(appData, "Cursor", "User", "globalStorage", "state.vscdb");
  }
  return join(home, ".config", "Cursor", "User", "globalStorage", "state.vscdb");
}

export function discoverSources(): DiscoverySources {
  const dbPath = cursorStateDbPath();
  return { dbPath, dbExists: existsSync(dbPath) };
}
