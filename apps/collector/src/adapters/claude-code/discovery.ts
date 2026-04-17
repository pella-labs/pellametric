import { existsSync } from "node:fs";
import { claudeProjectsDir } from "@bematist/config";

export interface DiscoverySources {
  otelEnabled: boolean;
  jsonlDir: string;
  jsonlDirExists: boolean;
}

export function discoverSources(): DiscoverySources {
  const jsonlDir = claudeProjectsDir();
  return {
    otelEnabled: process.env.CLAUDE_CODE_ENABLE_TELEMETRY === "1",
    jsonlDir,
    jsonlDirExists: existsSync(jsonlDir),
  };
}
