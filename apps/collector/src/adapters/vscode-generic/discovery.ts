import { existsSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import type { VSCodeDistro } from "@bematist/sdk";

export interface VSCodeProfile {
  distro: VSCodeDistro;
  /** The VS Code `User/` directory — parent of `workspaceStorage/` and `globalStorage/`. */
  userDir: string;
}

const DISTRO_DIRS: Record<VSCodeDistro, string> = {
  code: "Code",
  "code-insiders": "Code - Insiders",
  vscodium: "VSCodium",
  codium: "Codium",
};

/**
 * Return the platform-specific parent dir that holds VS Code distro folders.
 * macOS:   ~/Library/Application Support
 * Linux:   $XDG_CONFIG_HOME (or ~/.config)
 * Windows: %APPDATA%
 *
 * An explicit `BEMATIST_VSCODE_USER_ROOT` override wins for tests and
 * non-standard installs (e.g. portable Code).
 */
export function vscodeUserRoot(): string {
  const override = process.env.BEMATIST_VSCODE_USER_ROOT;
  if (override) return override;
  const home = homedir();
  switch (platform()) {
    case "darwin":
      return join(home, "Library", "Application Support");
    case "win32":
      return process.env.APPDATA ?? join(home, "AppData", "Roaming");
    default:
      return process.env.XDG_CONFIG_HOME ?? join(home, ".config");
  }
}

/**
 * Enumerate every discovered VS Code profile. Missing distros are skipped
 * silently — no warning, since the common case is that most users only run
 * one fork.
 */
export function discoverProfiles(): VSCodeProfile[] {
  const root = vscodeUserRoot();
  const out: VSCodeProfile[] = [];
  for (const [distro, dir] of Object.entries(DISTRO_DIRS) as Array<[VSCodeDistro, string]>) {
    const userDir = join(root, dir, "User");
    if (existsSync(userDir)) out.push({ distro, userDir });
  }
  return out;
}
