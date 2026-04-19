// `bematist logs` — tail the collector's stdout/stderr logs.
//
// macOS / Windows: the launchd plist / Scheduled Task redirect stdout/err
// into ~/.bematist/logs/{out,err}.log. We tail both.
// Linux: systemd sends output to the journal by default. We prefer
// `journalctl --user -u bematist.service -f` if journalctl is available;
// fall back to the log files if the user explicitly redirected there.

import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { platform } from "node:os";
import { daemonLogPaths } from "../daemon";

function tailFile(path: string, _prefix: string): void {
  if (!existsSync(path)) {
    return;
  }
  const tail = spawn("tail", ["-n", "50", "-F", path], { stdio: ["ignore", "inherit", "inherit"] });
  tail.on("error", (e) => {
    console.error(`bematist: tail failed for ${path}: ${e.message}`);
  });
}

function runJournalctl(): void {
  const j = spawn("journalctl", ["--user", "-u", "bematist.service", "-n", "50", "-f"], {
    stdio: ["ignore", "inherit", "inherit"],
  });
  j.on("error", () => {
    console.error("bematist: journalctl unavailable — falling back to log files");
    tailLogFiles();
  });
  j.on("exit", (code) => {
    if (code !== 0) {
      // journalctl exited with an error (e.g. unit not installed). Fall back.
      tailLogFiles();
    }
  });
}

function tailLogFiles(): void {
  const { stdout, stderr } = daemonLogPaths();
  const stdoutExists = existsSync(stdout) && statSync(stdout).size > 0;
  const stderrExists = existsSync(stderr) && statSync(stderr).size > 0;
  if (!stdoutExists && !stderrExists) {
    return;
  }
  tailFile(stdout, "stdout");
  tailFile(stderr, "stderr");
}

export async function runLogs(): Promise<void> {
  if (platform() === "linux") {
    runJournalctl();
    return;
  }
  tailLogFiles();
}
