#!/usr/bin/env bun
// Bematist — CLI entrypoint (bun --compile target). Binary name: bematist.
// Commands per CLAUDE.md §Commands:
//   status, audit --tail, dry-run, doctor, serve, --version.
import { runAudit } from "./commands/audit";
import { runConfig } from "./commands/config";
import { runDoctor } from "./commands/doctor";
import { runDryRun } from "./commands/dryRun";
import { runLogin } from "./commands/login";
import { runLogout } from "./commands/logout";
import { runLogs } from "./commands/logs";
import { runServe } from "./commands/serve";
import { runStart } from "./commands/start";
import { runStatus } from "./commands/status";
import { runStop } from "./commands/stop";
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
    case "config":
      await runConfig(args);
      return;
    case "login":
      await runLogin(args);
      return;
    case "logout":
      await runLogout(args);
      return;
    case "start":
      await runStart();
      return;
    case "stop":
      await runStop();
      return;
    case "logs":
      await runLogs();
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
  login               Authorize this machine against your Bematist org (browser flow)
  logout              Clear credentials from ~/.bematist/config.env
  start               Install + start the OS service (launchd / systemd / schtasks)
  stop                Stop the OS service
  status              Active adapters, last event, queue depth, daemon state
  logs                Tail the collector's stdout/err (or journalctl on Linux)
  serve               Run the collector daemon in foreground (blocks the terminal)
  dry-run             Poll once + log what would be sent, send nothing
  audit --tail [-n N] Stream the egress journal (Bill of Rights #1)
  doctor              Pre-flight checks: core dumps, ingest, adapters, sha256
  config <sub>        get/set/list persisted config (~/.bematist/config.env)
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
