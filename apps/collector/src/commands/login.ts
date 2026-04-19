// `bematist login` — OAuth 2.0 Device Authorization Grant (RFC 8628).
//
// Replaces the "copy-paste the install.sh one-liner with the token inline"
// shape with `gh auth login` / `stripe login` / `vercel login` UX: one
// command, browser opens to approve, CLI picks up credentials on poll.
//
// See apps/web/app/api/auth/device/code/route.ts and poll/route.ts for the
// server side; packages/api/src/schemas/deviceAuth.ts for the wire shapes.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { hostname, platform } from "node:os";

// Types mirror packages/api/src/schemas/deviceAuth.ts. Inlined here so the
// compiled binary doesn't transitively pull @bematist/api (which would drag
// in server-side query code we don't run on-device). Keep these in sync if
// the wire contract changes.
interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
}
interface DevicePollResponse {
  status: "pending" | "slow_down" | "expired" | "denied" | "approved";
  bearer?: string;
  endpoint?: string;
  org_slug?: string;
  org_name?: string;
  user_email?: string;
  slow_down_by?: number;
}

import { atomicWrite, configEnvPath, dataDir } from "@bematist/config";
import { COLLECTOR_VERSION, parseEnvFile } from "../config";
import { daemonStart } from "../daemon";

const DEFAULT_WEB_URL = "https://bematist.dev";
const POLL_MAX_ATTEMPTS = 180; // 10 min @ 5s interval = 120, +buffer

interface LoginOptions {
  webUrl: string;
  printOnly: boolean;
  force: boolean;
  autoStart: boolean;
}

function parseArgs(args: string[]): LoginOptions {
  // webUrl is the web backend (Next.js); BEMATIST_ENDPOINT is the ingest
  // backend (OTLP + /v1/events). They are architecturally separate
  // services, so don't try to derive one from the other — a previous
  // regex-based ingest→web substitution silently fell through for
  // hyphen-delimited hostnames (e.g. Railway's
  // `ingest-development.up.railway.app`) and the CLI hit a 404 because
  // the derived URL stayed on the ingest host. Callers that run their
  // own web backend set BEMATIST_WEB_URL or pass --web-url.
  let webUrl = process.env.BEMATIST_WEB_URL ?? DEFAULT_WEB_URL;
  let printOnly = false;
  let force = false;
  let autoStart = true;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--web-url" || arg === "--web") {
      const next = args[++i];
      if (!next) {
        console.error("bematist login: --web-url requires a value");
        process.exit(2);
      }
      webUrl = next;
    } else if (arg?.startsWith("--web-url=")) {
      webUrl = arg.slice("--web-url=".length);
    } else if (arg === "--print-only") {
      printOnly = true;
    } else if (arg === "--force" || arg === "-f") {
      force = true;
    } else if (arg === "--no-start") {
      autoStart = false;
    } else if (arg === "--help" || arg === "-h") {
      console.log(usage());
      process.exit(0);
    } else if (arg !== undefined) {
      console.error(`bematist login: unknown flag: ${arg}`);
      console.error(usage());
      process.exit(2);
    }
  }

  return { webUrl: webUrl.replace(/\/$/, ""), printOnly, force, autoStart };
}

function usage(): string {
  return [
    "bematist login — authorize this machine to ship events to your org.",
    "",
    "Usage:",
    "  bematist login [--web-url <url>] [--print-only] [--force] [--no-start]",
    "",
    "Flags:",
    "  --web-url <url>  Web backend to authorize against (default: https://bematist.dev).",
    "                   Also respects $BEMATIST_WEB_URL.",
    "  --print-only     Print the URL + code without attempting to open a browser",
    "                   (for SSH / headless / Docker).",
    "  --force, -f      Replace an existing token without prompting.",
    "  --no-start       Skip the auto-start that follows a successful login.",
  ].join("\n");
}

function existingToken(): string | null {
  const path = configEnvPath();
  if (!existsSync(path)) return null;
  try {
    const vars = parseEnvFile(readFileSync(path, "utf8"));
    return vars.BEMATIST_TOKEN ?? null;
  } catch {
    return null;
  }
}

function deviceLabel(): string {
  const host = hostname();
  const os = platform();
  return `${host} (${os}-${process.arch}, bematist ${COLLECTOR_VERSION})`;
}

function openInBrowser(url: string): boolean {
  const cmd = platform() === "darwin" ? "open" : platform() === "win32" ? "cmd" : "xdg-open";
  const args = platform() === "win32" ? ["/c", "start", "", url] : [url];
  const r = spawnSync(cmd, args, { stdio: "ignore" });
  return r.status === 0;
}

async function postJson<T>(url: string, body: unknown, timeoutMs = 10_000): Promise<T> {
  // Timeout guard — a silent fetch hang is worse than a loud error. 10s is
  // long enough for a cold start + DB round-trip on any reasonable deploy;
  // anything beyond that is almost certainly a misconfigured backend.
  //
  // Using manual AbortController + clearTimeout so the timer is cleaned up
  // on success. `AbortSignal.timeout()` leaks a pending timer into the
  // event loop that, in Bun, prevents the process from exiting until the
  // full timeout has elapsed — reported as "bematist login hangs 10s
  // before `&& bematist start` runs in the one-liner chain."
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": `bematist-cli/${COLLECTOR_VERSION}`,
      },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`POST ${url} → HTTP ${res.status}: ${text}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

function formatCode(code: string): string {
  if (code.length === 8) return `${code.slice(0, 4)}-${code.slice(4)}`;
  return code;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function writeCredentials(endpoint: string, bearer: string): Promise<string> {
  const path = configEnvPath();
  const dir = dataDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });

  // Merge with existing file so we preserve other BEMATIST_* settings (log
  // level, poll interval overrides, etc.) the user has set by hand.
  const existing = existsSync(path) ? parseEnvFile(readFileSync(path, "utf8")) : {};
  existing.BEMATIST_ENDPOINT = endpoint;
  existing.BEMATIST_TOKEN = bearer;

  const header =
    "# bematist collector config — written by `bematist login`.\n" +
    "# See dev-docs/m5-installer-plan.md. Safe to hand-edit; preserve KEY=VALUE form.\n";
  const body = Object.entries(existing)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  await atomicWrite(path, `${header}${body}\n`, { mode: 0o600 });
  return path;
}

export async function runLogin(args: string[]): Promise<void> {
  const opts = parseArgs(args);

  if (!opts.force && existingToken()) {
    console.error("bematist: already logged in (token exists in ~/.bematist/config.env).");
    console.error("bematist: re-run with --force to replace, or `bematist logout` to clear.");
    process.exit(1);
  }

  // 1. Ask the web backend for a device code.
  const codeUrl = `${opts.webUrl}/api/auth/device/code`;
  let code: DeviceCodeResponse;
  try {
    code = await postJson<DeviceCodeResponse>(codeUrl, {
      client_version: COLLECTOR_VERSION,
      device_label: deviceLabel(),
    });
  } catch (e) {
    console.error(`bematist: failed to start device login: ${(e as Error).message}`);
    console.error(`bematist: check that ${opts.webUrl} is reachable (--web-url to override).`);
    process.exit(1);
  }

  // 2. Surface URL + code. Try to open a browser; fall back gracefully.
  const opened = !opts.printOnly && openInBrowser(code.verification_uri_complete);
  if (opened) {
    console.log(`bematist: opened ${code.verification_uri_complete} in your browser.`);
  } else {
    console.log("bematist: open this URL to authorize:");
    console.log(`  ${code.verification_uri_complete}`);
  }
  console.log(`bematist: verify the code matches: ${formatCode(code.user_code)}`);
  console.log(`bematist: waiting for approval (expires in ${Math.floor(code.expires_in / 60)}m)…`);

  // 3. Poll until approved / terminal state / we run out of attempts.
  const pollUrl = `${opts.webUrl}/api/auth/device/poll`;
  let interval = Math.max(code.interval, 1);

  for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
    await sleep(interval * 1_000);

    let poll: DevicePollResponse;
    try {
      poll = await postJson<DevicePollResponse>(pollUrl, { device_code: code.device_code });
    } catch (e) {
      // Transient network failures shouldn't abort; the approved window is
      // 10min and the user is actively interacting. Log once and continue.
      console.error(`bematist: poll failed (${(e as Error).message}); retrying…`);
      continue;
    }

    switch (poll.status) {
      case "pending":
        continue;
      case "slow_down":
        interval += poll.slow_down_by ?? 5;
        continue;
      case "expired":
        console.error("bematist: code expired before you approved. Run `bematist login` again.");
        return process.exit(1);
      case "denied":
        console.error("bematist: request denied. Run `bematist login` if you want to retry.");
        return process.exit(1);
      case "approved": {
        if (!poll.bearer || !poll.endpoint) {
          console.error("bematist: server returned approved status without credentials; aborting.");
          process.exit(1);
        }
        const path = await writeCredentials(poll.endpoint, poll.bearer);
        const who = poll.user_email ? `${poll.user_email} → ` : "";
        const org = poll.org_name ?? poll.org_slug ?? "your org";
        console.log(`bematist: approved. logged in as ${who}${org}.`);
        console.log(`bematist: config saved to ${path}`);

        if (opts.autoStart) {
          // Auto-start the OS daemon so the one-liner lands the user with
          // a running collector. Pass `--no-start` to opt out (e.g. when
          // scripting, or when the caller wants to stage config and start
          // under its own lifecycle).
          const start = daemonStart();
          console.log(`bematist: ${start.summary}`);
          if (start.state !== "running") {
            console.log(
              "bematist: run `bematist status` to inspect, or `bematist logs` for errors.",
            );
          }
        } else {
          console.log("bematist: next: `bematist start` to launch the background collector.");
        }
        return;
      }
    }
  }

  console.error("bematist: timed out waiting for approval. Run `bematist login` again.");
  process.exit(1);
}
