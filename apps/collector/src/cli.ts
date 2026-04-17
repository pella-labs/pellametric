#!/usr/bin/env bun
// DevMetrics — CLI entrypoint (bun --compile target). Binary name: devmetrics (PRD §D32).
// Internal code slug / workspace package is `@bematist/collector`; user-facing
// binary + help text + error messages use the product name "devmetrics".
import { runAudit } from "./commands/audit";
import { runDryRun } from "./commands/dryRun";
import { runServe } from "./commands/serve";
import { runStatus } from "./commands/status";
import { harden } from "./harden";

async function main() {
  harden();
  const [, , cmd, ...args] = process.argv;

  switch (cmd) {
    case "status":
      await runStatus();
      return;
    case "audit":
      await runAudit(args);
      return;
    case "dry-run":
      await runDryRun(args);
      return;
    case "serve":
      await runServe();
      return;
    case undefined:
    case "-h":
    case "--help":
    case "help":
      printHelp();
      return;
    default:
      console.error(`devmetrics: unknown command: ${cmd}`);
      printHelp();
      process.exit(2);
  }
}

function printHelp() {
  console.log(`devmetrics — collector CLI (M1)

Commands:
  status            Adapter health + last event + queue depth
  audit --tail -n N Dump last N egress-journal rows as NDJSON
  dry-run           Run the daemon once without egress (log-only)
  serve             Run the collector daemon
`);
}

main().catch((e) => {
  console.error("devmetrics: fatal", e);
  process.exit(1);
});
