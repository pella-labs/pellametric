#!/usr/bin/env node
/**
 * telemetryc collector — legacy one-shot entry.
 *
 * Bundled into apps/web/public/collector.mjs by `bun run build` and
 * served as the curl-piped fallback from /setup/collector for users
 * who haven't installed the binary yet. The streaming daemon lives in
 * src/serve.ts and is the production path for anyone on the binary.
 *
 * Usage:
 *   curl -fsSL .../collector.mjs | node - --token pm_xxx
 *        [--url http://localhost:3000] [--since 2026-03-01]
 */
import { runOnce } from "./commands/runOnce";

const args = parseArgs(process.argv.slice(2));
const TOKEN = args.token || process.env.PELLA_TOKEN;
declare const __DEFAULT_URL__: string;
const DEFAULT_URL = typeof __DEFAULT_URL__ === "string" ? __DEFAULT_URL__ : "http://localhost:3000";
const URL = (args.url || process.env.PELLA_URL || DEFAULT_URL).replace(/\/$/, "");
const SINCE = args.since ? new Date(args.since) : new Date(0);

if (!TOKEN) {
  console.error("Missing --token");
  process.exit(1);
}

runOnce({ url: URL, token: TOKEN, since: SINCE }).catch((e) => {
  console.error(e);
  process.exit(1);
});

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
      out[key] = val;
    }
  }
  return out;
}
