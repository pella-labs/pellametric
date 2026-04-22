import { writeConfig, DEFAULT_URL } from "../config";
import { daemonStart } from "../daemon";

interface LoginOptions {
  token: string;
  url: string;
  autoStart: boolean;
}

function parseLoginArgs(args: string[]): LoginOptions {
  let token = "";
  let url = process.env.PELLA_URL || DEFAULT_URL;
  let autoStart = true;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--token") token = args[++i] ?? "";
    else if (a?.startsWith("--token=")) token = a.slice("--token=".length);
    else if (a === "--url") url = args[++i] ?? url;
    else if (a?.startsWith("--url=")) url = a.slice("--url=".length);
    else if (a === "--no-start") autoStart = false;
    else if (a === "-h" || a === "--help") {
      console.log(usage());
      process.exit(0);
    } else if (a) {
      console.error(`pella login: unknown arg: ${a}`);
      console.error(usage());
      process.exit(2);
    }
  }
  return { token, url: url.replace(/\/$/, ""), autoStart };
}

function usage(): string {
  return [
    "pella login — save your API token and start the collector.",
    "",
    "Usage:",
    "  pella login --token pm_xxx [--url https://…] [--no-start]",
    "",
    "Flags:",
    "  --token <pm_…>   API token from https://pellametric.com/setup/collector",
    "  --url   <url>    Ingest backend (default: https://pellametric.com)",
    "  --no-start       Skip auto-start; just write config.env.",
  ].join("\n");
}

export async function runLogin(args: string[]): Promise<void> {
  const opts = parseLoginArgs(args);
  if (!opts.token) {
    console.error("pella login: --token is required.");
    console.error(usage());
    process.exit(2);
  }
  const p = writeConfig(opts.token, opts.url);
  console.log(`pella: config saved to ${p}`);

  if (!opts.autoStart) {
    console.log("pella: next: run `pella start` to launch the background collector.");
    return;
  }
  const res = daemonStart();
  console.log(`pella: ${res.summary}`);
  if (res.state !== "running") {
    console.log("pella: check `pella status` / `pella logs` if the service didn't come up.");
    process.exit(1);
  }
}
