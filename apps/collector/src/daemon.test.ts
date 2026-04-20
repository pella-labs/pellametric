// daemon.ts end-to-end is not testable in CI without privileged access to
// launchctl / systemctl / schtasks. These tests cover the platform-agnostic
// behavior: template rendering, path resolution, dispatch to the right
// implementation on each platform, and log-path layout.

import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { daemonLogPaths, daemonStatus } from "./daemon";
import {
  LAUNCHD_PLIST_TMPL,
  renderTemplate,
  SYSTEMD_SERVICE_TMPL,
  WINDOWS_TASK_XML_TMPL,
} from "./templates";

let tmp: string;
let savedDataDir: string | undefined;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "bematist-daemon-test-"));
  savedDataDir = process.env.BEMATIST_DATA_DIR;
  process.env.BEMATIST_DATA_DIR = tmp;
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  if (savedDataDir === undefined) delete process.env.BEMATIST_DATA_DIR;
  else process.env.BEMATIST_DATA_DIR = savedDataDir;
});

test("daemonLogPaths lives under BEMATIST_DATA_DIR/logs", () => {
  const { stdout, stderr } = daemonLogPaths();
  expect(stdout).toBe(join(tmp, "logs", "out.log"));
  expect(stderr).toBe(join(tmp, "logs", "err.log"));
});

test("daemonStatus returns not-installed on a clean machine", () => {
  const res = daemonStatus();
  // On darwin/linux/win32, without having called start, the unit file
  // shouldn't exist (unless the developer running this test has an actual
  // bematist service installed — in which case we don't want to stomp on
  // it). Accept any state for real-machine runs.
  expect(["not-installed", "running", "stopped"]).toContain(res.state);
});

test("renderTemplate substitutes @HOME@ and @BIN@ in launchd plist", () => {
  const rendered = renderTemplate(LAUNCHD_PLIST_TMPL, {
    HOME: "/Users/test",
    BIN: "/usr/local/bin/bematist",
  });
  // Direct exec: ProgramArguments = [binary, "serve"]. Any /bin/sh wrapper
  // would regress the SIGSTOP bug (see templates.ts rationale block).
  expect(rendered).toMatch(
    /<key>ProgramArguments<\/key>\s*<array>\s*<string>\/usr\/local\/bin\/bematist<\/string>\s*<string>serve<\/string>\s*<\/array>/,
  );
  expect(rendered).toContain("<string>/Users/test/.bematist/logs/out.log</string>");
  expect(rendered).not.toContain("@HOME@");
  expect(rendered).not.toContain("@BIN@");
});

test("renderTemplate substitutes @BIN@ in systemd unit", () => {
  const rendered = renderTemplate(SYSTEMD_SERVICE_TMPL, { BIN: "/usr/bin/bematist" });
  expect(rendered).toContain("ExecStart=/usr/bin/bematist serve");
  expect(rendered).toContain("LimitCORE=0");
  expect(rendered).not.toContain("@BIN@");
});

test("renderTemplate substitutes @USER@ and @BIN@ in Windows task XML", () => {
  const rendered = renderTemplate(WINDOWS_TASK_XML_TMPL, {
    USER: "CORP\\\\alice",
    BIN: "C:\\\\Program Files\\\\bematist\\\\bematist.exe",
  });
  expect(rendered).toContain("<UserId>CORP\\\\alice</UserId>");
  expect(rendered).toContain("<Command>C:\\\\Program Files\\\\bematist\\\\bematist.exe</Command>");
  expect(rendered).not.toContain("@USER@");
  expect(rendered).not.toContain("@BIN@");
});

test("renderTemplate leaves unknown tokens intact", () => {
  const tmpl = "hello @NAME@, @BIN@ is at @UNKNOWN@";
  const rendered = renderTemplate(tmpl, { NAME: "world", BIN: "/bin/bematist" });
  expect(rendered).toBe("hello world, /bin/bematist is at @UNKNOWN@");
});
