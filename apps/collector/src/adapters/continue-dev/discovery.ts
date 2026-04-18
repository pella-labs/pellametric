import { existsSync, statSync } from "node:fs";
import {
  CONTINUE_STREAM_NAMES,
  type ContinueStreamName,
  continueDevDataDir,
  continueStreamPath,
} from "./paths";

export interface ContinueDiscovery {
  baseDir: string;
  baseDirExists: boolean;
  /** Which of the four streams have a readable file present. Missing is OK. */
  streams: Record<ContinueStreamName, { path: string; exists: boolean; size: number }>;
}

export function discoverSources(): ContinueDiscovery {
  const baseDir = continueDevDataDir();
  const baseDirExists = existsSync(baseDir);

  const streams = {} as ContinueDiscovery["streams"];
  for (const name of CONTINUE_STREAM_NAMES) {
    const path = continueStreamPath(name);
    let exists = false;
    let size = 0;
    try {
      const st = statSync(path);
      if (st.isFile()) {
        exists = true;
        size = st.size;
      }
    } catch {
      // missing or unreadable — leave defaults.
    }
    streams[name] = { path, exists, size };
  }

  return { baseDir, baseDirExists, streams };
}
