// Cross-platform daemon lifecycle — launchd / systemd --user / Windows
// Scheduled Task. Drives `bematist start|stop|status|logs`.
//
// Keep the surface small: each function returns a DaemonResult so callers
// can render it uniformly. Never throws for expected states (not installed,
// not running) — only for genuinely unexpected errors.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir, platform, userInfo } from "node:os";
import { dirname, join } from "node:path";
import { dataDir } from "@bematist/config";
import {
  LAUNCHD_PLIST_TMPL,
  renderTemplate,
  SYSTEMD_SERVICE_TMPL,
  WINDOWS_TASK_XML_TMPL,
} from "./templates";

export type DaemonState = "running" | "stopped" | "not-installed";

export interface DaemonResult {
  state: DaemonState;
  platform: NodeJS.Platform;
  unitPath: string;
  /** Human-readable one-liner for CLI output. */
  summary: string;
  /** Raw subprocess output when helpful (systemctl show, launchctl print…). */
  detail?: string;
}

const LAUNCHD_LABEL = "dev.bematist.collector";
const SYSTEMD_UNIT = "bematist.service";
const WINDOWS_TASK = "\\Bematist\\Collector";

function resolveBinary(): string {
  // `bematist` binary path. argv[1] points at the CLI entry; argv[0] is
  // the bun runtime when running under `bun run`. On a compiled binary,
  // execPath is the binary itself. Prefer execPath on a compiled binary
  // (detected by absence of `bun` in the basename).
  const exec = process.execPath;
  if (exec && !exec.endsWith("bun") && !exec.endsWith("bun.exe")) {
    return exec;
  }
  // Dev / `bun run` mode — best effort: whichever `bematist` is on PATH.
  // Caller can override via BEMATIST_BIN_PATH.
  if (process.env.BEMATIST_BIN_PATH) return process.env.BEMATIST_BIN_PATH;
  return "bematist";
}

function run(cmd: string, args: string[]): { status: number; stdout: string; stderr: string } {
  const r = spawnSync(cmd, args, { encoding: "utf8" });
  return {
    status: r.status ?? -1,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
  };
}

// ---------- macOS (launchd) ----------

function launchdUnitPath(): string {
  return join(homedir(), "Library", "LaunchAgents", `${LAUNCHD_LABEL}.plist`);
}

function launchdDomain(): string {
  return `gui/${userInfo().uid}`;
}

function launchdInstall(bin: string): string {
  const path = launchdUnitPath();
  const content = renderTemplate(LAUNCHD_PLIST_TMPL, { HOME: homedir(), BIN: bin });
  mkdirSync(dirname(path), { recursive: true });
  mkdirSync(join(dataDir(), "logs"), { recursive: true });
  writeFileSync(path, content, { mode: 0o644 });
  return path;
}

function launchdIsLoaded(): boolean {
  const r = run("launchctl", ["print", `${launchdDomain()}/${LAUNCHD_LABEL}`]);
  return r.status === 0;
}

function launchdIsRunning(): boolean {
  const r = run("launchctl", ["print", `${launchdDomain()}/${LAUNCHD_LABEL}`]);
  if (r.status !== 0) return false;
  // `state = running` in the output indicates an active PID.
  return /state\s*=\s*running/i.test(r.stdout);
}

function launchdStart(): DaemonResult {
  const bin = resolveBinary();
  const unitPath = launchdInstall(bin);
  // `bootstrap` loads the plist into the user's GUI domain. If already
  // loaded, bootstrap returns 37 ("Input/output error" — "Load failed:
  // already loaded"). Treat that as success.
  const boot = run("launchctl", ["bootstrap", launchdDomain(), unitPath]);
  if (boot.status !== 0 && !/already loaded/i.test(boot.stderr + boot.stdout)) {
    return {
      state: "stopped",
      platform: "darwin",
      unitPath,
      summary: `launchctl bootstrap failed: ${boot.stderr.trim() || boot.stdout.trim()}`,
      detail: boot.stderr,
    };
  }
  // Kickstart forces a restart — picks up config.env edits. `-s` makes
  // kickstart synchronous (wait for the service to respond before
  // returning) — otherwise `launchctl print` below can race the agent's
  // startup and report `state=stopped` for a process that's about to be
  // running.
  run("launchctl", ["kickstart", "-k", "-s", `${launchdDomain()}/${LAUNCHD_LABEL}`]);
  // Belt-and-suspenders: poll briefly for running state (max ~1s) to
  // absorb the remaining kickstart→print race window on slower machines.
  let running = false;
  for (let i = 0; i < 5; i++) {
    running = launchdIsRunning();
    if (running) break;
    const until = Date.now() + 200;
    while (Date.now() < until) {} // brief busy-wait; spawnSync is blocking so no event loop to await
  }
  return {
    state: running ? "running" : "stopped",
    platform: "darwin",
    unitPath,
    summary: running
      ? `bematist started (launchd: ${LAUNCHD_LABEL})`
      : "launchd loaded the unit but the process isn't confirmed running — check `bematist logs` / `bematist status`",
  };
}

function launchdStop(): DaemonResult {
  const unitPath = launchdUnitPath();
  if (!existsSync(unitPath)) {
    return {
      state: "not-installed",
      platform: "darwin",
      unitPath,
      summary: "bematist is not installed as a launchd agent",
    };
  }
  const r = run("launchctl", ["bootout", launchdDomain(), unitPath]);
  if (r.status !== 0 && !/not loaded/i.test(r.stderr + r.stdout)) {
    return {
      state: "running",
      platform: "darwin",
      unitPath,
      summary: `launchctl bootout failed: ${r.stderr.trim() || r.stdout.trim()}`,
    };
  }
  return {
    state: "stopped",
    platform: "darwin",
    unitPath,
    summary: "bematist stopped",
  };
}

function launchdStatus(): DaemonResult {
  const unitPath = launchdUnitPath();
  if (!existsSync(unitPath)) {
    return {
      state: "not-installed",
      platform: "darwin",
      unitPath,
      summary: "not installed (run `bematist start`)",
    };
  }
  if (!launchdIsLoaded()) {
    return {
      state: "stopped",
      platform: "darwin",
      unitPath,
      summary: "unit file exists but not loaded — run `bematist start`",
    };
  }
  const r = run("launchctl", ["print", `${launchdDomain()}/${LAUNCHD_LABEL}`]);
  const running = /state\s*=\s*running/i.test(r.stdout);
  return {
    state: running ? "running" : "stopped",
    platform: "darwin",
    unitPath,
    summary: running ? "running" : "loaded but not running",
    detail: r.stdout,
  };
}

// ---------- Linux (systemd --user) ----------

function systemdUnitPath(): string {
  return join(homedir(), ".config", "systemd", "user", SYSTEMD_UNIT);
}

function systemdInstall(bin: string): string {
  const path = systemdUnitPath();
  const content = renderTemplate(SYSTEMD_SERVICE_TMPL, { BIN: bin });
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, { mode: 0o644 });
  return path;
}

function systemdIsActive(): boolean {
  const r = run("systemctl", ["--user", "is-active", SYSTEMD_UNIT]);
  return r.stdout.trim() === "active";
}

function systemdStart(): DaemonResult {
  const bin = resolveBinary();
  const unitPath = systemdInstall(bin);
  const reload = run("systemctl", ["--user", "daemon-reload"]);
  if (reload.status !== 0) {
    return {
      state: "stopped",
      platform: "linux",
      unitPath,
      summary: `systemctl daemon-reload failed: ${reload.stderr.trim()}`,
    };
  }
  const enable = run("systemctl", ["--user", "enable", "--now", SYSTEMD_UNIT]);
  if (enable.status !== 0) {
    return {
      state: "stopped",
      platform: "linux",
      unitPath,
      summary: `systemctl enable --now failed: ${enable.stderr.trim() || enable.stdout.trim()}`,
    };
  }
  const running = systemdIsActive();
  let summary = running
    ? `bematist started (systemd --user: ${SYSTEMD_UNIT})`
    : "unit enabled but not active — check `bematist logs`";
  // If linger isn't enabled, the service stops at logout — surface that
  // as a note so the user isn't surprised on reboot.
  const linger = run("loginctl", ["show-user", userInfo().username, "-p", "Linger"]);
  if (linger.status === 0 && /Linger=no/i.test(linger.stdout)) {
    summary += " — note: `loginctl enable-linger` required for survive-logout";
  }
  return { state: running ? "running" : "stopped", platform: "linux", unitPath, summary };
}

function systemdStop(): DaemonResult {
  const unitPath = systemdUnitPath();
  if (!existsSync(unitPath)) {
    return {
      state: "not-installed",
      platform: "linux",
      unitPath,
      summary: "bematist is not installed as a systemd user unit",
    };
  }
  run("systemctl", ["--user", "disable", "--now", SYSTEMD_UNIT]);
  return { state: "stopped", platform: "linux", unitPath, summary: "bematist stopped" };
}

function systemdStatus(): DaemonResult {
  const unitPath = systemdUnitPath();
  if (!existsSync(unitPath)) {
    return {
      state: "not-installed",
      platform: "linux",
      unitPath,
      summary: "not installed (run `bematist start`)",
    };
  }
  const r = run("systemctl", ["--user", "show", SYSTEMD_UNIT, "--no-page"]);
  const active = systemdIsActive();
  return {
    state: active ? "running" : "stopped",
    platform: "linux",
    unitPath,
    summary: active ? "running" : "installed but not active",
    detail: r.stdout,
  };
}

// ---------- Windows (Scheduled Task) ----------

function windowsTaskXmlPath(): string {
  return join(dataDir(), "bematist-task.xml");
}

function windowsInstall(bin: string): string {
  const path = windowsTaskXmlPath();
  const user = `${userInfo().username}`;
  const content = renderTemplate(WINDOWS_TASK_XML_TMPL, { USER: user, BIN: bin });
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  run("schtasks", ["/Create", "/TN", WINDOWS_TASK, "/XML", path, "/F"]);
  return path;
}

function windowsIsRunning(): boolean {
  const r = run("schtasks", ["/Query", "/TN", WINDOWS_TASK, "/FO", "CSV", "/NH"]);
  if (r.status !== 0) return false;
  // CSV row: "TaskName","Next Run Time","Status"
  return /"Running"/i.test(r.stdout);
}

function windowsStart(): DaemonResult {
  const bin = resolveBinary();
  const unitPath = windowsInstall(bin);
  const runRes = run("schtasks", ["/Run", "/TN", WINDOWS_TASK]);
  if (runRes.status !== 0) {
    return {
      state: "stopped",
      platform: "win32",
      unitPath,
      summary: `schtasks /Run failed: ${runRes.stderr.trim() || runRes.stdout.trim()}`,
    };
  }
  return {
    state: "running",
    platform: "win32",
    unitPath,
    summary: `bematist started (Scheduled Task: ${WINDOWS_TASK})`,
  };
}

function windowsStop(): DaemonResult {
  const unitPath = windowsTaskXmlPath();
  run("schtasks", ["/End", "/TN", WINDOWS_TASK]);
  run("schtasks", ["/Delete", "/TN", WINDOWS_TASK, "/F"]);
  return { state: "stopped", platform: "win32", unitPath, summary: "bematist stopped" };
}

function windowsStatus(): DaemonResult {
  const unitPath = windowsTaskXmlPath();
  const q = run("schtasks", ["/Query", "/TN", WINDOWS_TASK, "/FO", "CSV", "/NH"]);
  if (q.status !== 0) {
    return {
      state: "not-installed",
      platform: "win32",
      unitPath,
      summary: "not installed (run `bematist start`)",
    };
  }
  const running = /"Running"/i.test(q.stdout);
  return {
    state: running ? "running" : "stopped",
    platform: "win32",
    unitPath,
    summary: running ? "running" : "installed but not running",
    detail: q.stdout,
  };
}

// ---------- Dispatch ----------

export function daemonStart(): DaemonResult {
  switch (platform()) {
    case "darwin":
      return launchdStart();
    case "linux":
      return systemdStart();
    case "win32":
      return windowsStart();
    default:
      return {
        state: "stopped",
        platform: platform(),
        unitPath: "",
        summary: `unsupported platform: ${platform()}`,
      };
  }
}

export function daemonStop(): DaemonResult {
  switch (platform()) {
    case "darwin":
      return launchdStop();
    case "linux":
      return systemdStop();
    case "win32":
      return windowsStop();
    default:
      return {
        state: "stopped",
        platform: platform(),
        unitPath: "",
        summary: `unsupported platform: ${platform()}`,
      };
  }
}

export function daemonStatus(): DaemonResult {
  switch (platform()) {
    case "darwin":
      return launchdStatus();
    case "linux":
      return systemdStatus();
    case "win32":
      return windowsStatus();
    default:
      return {
        state: "not-installed",
        platform: platform(),
        unitPath: "",
        summary: `unsupported platform: ${platform()}`,
      };
  }
}

export function daemonLogPaths(): { stdout: string; stderr: string } {
  const logs = join(dataDir(), "logs");
  return { stdout: join(logs, "out.log"), stderr: join(logs, "err.log") };
}
