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

function printHelp() {}

main().catch((e) => {
  console.error("bematist: fatal", e);
  process.exit(1);
});
