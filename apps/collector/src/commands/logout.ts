// `bematist logout` — clear BEMATIST_ENDPOINT + BEMATIST_TOKEN from
// ~/.bematist/config.env. Leaves other settings (log level, poll interval
// overrides, data dir) in place so next login doesn't make the user
// reconfigure them.

import { existsSync, readFileSync } from "node:fs";
import { atomicWrite, configEnvPath } from "@bematist/config";
import { parseEnvFile } from "../config";

export async function runLogout(_args: string[]): Promise<void> {
  const path = configEnvPath();
  if (!existsSync(path)) {
    console.log("bematist: no config.env found — nothing to log out of.");
    return;
  }

  const vars = parseEnvFile(readFileSync(path, "utf8"));
  const hadToken = "BEMATIST_TOKEN" in vars;
  delete vars.BEMATIST_ENDPOINT;
  delete vars.BEMATIST_TOKEN;

  const body = Object.entries(vars)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const header =
    "# bematist collector config — written by `bematist logout`.\n" +
    "# See dev-docs/m5-installer-plan.md. Safe to hand-edit; preserve KEY=VALUE form.\n";
  const content = body ? `${header}${body}\n` : header;
  await atomicWrite(path, content, { mode: 0o600 });

  if (hadToken) {
    console.log(`bematist: cleared token from ${path}`);
  } else {
    console.log(`bematist: no token was set; ${path} unchanged`);
  }
  console.log("bematist: run `bematist stop` if you want to stop the background collector too.");
}
