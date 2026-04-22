// Bundle the collector for Node. Equivalent to:
//   bun build src/index.ts --target=node --outfile=../web/public/collector.mjs
// but with --define support (the CLI doesn't expose it yet).
//
// The bundle is served at /collector.mjs from the web app and run as
// `node - --token pm_xxx` by users pasting the one-liner from /setup/collector.

import { build } from "bun";
import { chmodSync } from "node:fs";

const OUT = "../web/public/collector.mjs";
const DEFAULT_URL =
  process.env.PELLA_COLLECTOR_DEFAULT_URL ?? "https://pella-web-production.up.railway.app";

const result = await build({
  entrypoints: ["src/index.ts"],
  target: "node",
  outdir: "../web/public",
  naming: "collector.mjs",
  define: {
    __DEFAULT_URL__: JSON.stringify(DEFAULT_URL),
  },
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

// Keep the file executable-ish — the first line is a node shebang.
try {
  chmodSync(OUT, 0o755);
} catch {}

console.log(`collector.mjs → ${OUT} (default URL: ${DEFAULT_URL})`);
