#!/usr/bin/env bun
// Bematist — CLI entrypoint (bun --compile target). Binary name: bematist.
// Commands per CLAUDE.md §Commands:
//   status, audit --tail, dry-run, doctor, serve, --version.
import { runAudit } from "./commands/audit";
import { runDoctor } from "./commands/doctor";
import { runDryRun } from "./commands/dryRun";
import { runServe } from "./commands/serve";
import { runStatus } from "./commands/status";
import { COLLECTOR_VERSION } from "./config";
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
    case "doctor":
      await runDoctor(args);
      return;
    case "serve":
      await runServe();
      return;
    case "--version":
    case "-v":
    case "version":
      console.log(`bematist ${COLLECTOR_VERSION}`);
      return;
    case undefined:
    case "-h":
    case "--help":
    case "help":
      printHelp();
      return;
    default:
      console.error(`bematist: unknown command: ${cmd}`);
      printHelp();
      process.exit(2);
  }
}

function printHelp() {
  console.log(`bematist ${COLLECTOR_VERSION} — collector CLI

Commands:
  serve               Run the collector daemon (reads BEMATIST_* env)
  status              Active adapters, last event, queue depth, version
  dry-run             Poll once + log what would be sent, send nothing
  audit --tail [-n N] Stream the egress journal (Bill of Rights #1)
  doctor              Pre-flight checks: core dumps, ingest, adapters, sha256
  --version           Print version

Environment (see CLAUDE.md §Environment Variables):
  BEMATIST_ENDPOINT       Ingest URL (default http://localhost:8000)
  BEMATIST_TOKEN          Bearer token (required for serve)
  BEMATIST_DATA_DIR       Egress journal + state dir (default ~/.bematist)
  BEMATIST_DRY_RUN=1      Log what would be sent, send nothing
  BEMATIST_LOG_LEVEL      pino level (default warn)
  BEMATIST_INGEST_ONLY_TO Egress allowlist (cert-pinning host)
`);
}

main().catch((e) => {
  console.error("bematist: fatal", e);
  process.exit(1);
});
