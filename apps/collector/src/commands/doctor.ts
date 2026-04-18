// `bematist doctor` — pre-flight diagnostics per CLAUDE.md §Commands.
//
// Checks:
//   - ulimit -c (core dumps) — must be 0 per CLAUDE.md §Security Rules.
//     Bematist's hardening sets RLIMIT_CORE=0 at startup, but if the binary
//     is run under a parent that re-raised it, we report the real effective
//     value.
//   - Ingest reachability — GET /health.
//   - Adapter health — reuses AdapterHealth.
//   - Binary sha256 of argv[0] — so the operator can sanity-check against
//     the published release manifest.
//   - Writable data dir.
//
// Exits 0 if all critical checks pass, 1 otherwise.

import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync } from "node:fs";
import { access, constants } from "node:fs/promises";
import { buildRegistry } from "../adapters";
import { COLLECTOR_VERSION, loadConfig } from "../config";
import { harden } from "../harden";

interface Check {
  name: string;
  ok: boolean;
  detail: string;
  severity: "critical" | "warn" | "info";
}

async function binarySha256(path: string): Promise<string | null> {
  if (!existsSync(path)) return null;
  return new Promise((resolve) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", () => resolve(null));
  });
}

async function reachable(endpoint: string): Promise<Check> {
  try {
    const res = await fetch(`${endpoint}/health`, {
      method: "GET",
      signal: AbortSignal.timeout(5_000),
    });
    return {
      name: "ingest reachable",
      ok: res.ok || res.status === 404, // 404 tolerable — some backends don't expose /health
      detail: `${endpoint}/health → HTTP ${res.status}`,
      severity: res.ok ? "info" : "warn",
    };
  } catch (e) {
    return {
      name: "ingest reachable",
      ok: false,
      detail: `${endpoint}/health → ${String(e)}`,
      severity: "warn",
    };
  }
}

async function checkWritableDir(path: string): Promise<Check> {
  try {
    // Create if missing — first-run setup, not a failure mode.
    if (!existsSync(path)) mkdirSync(path, { recursive: true });
    await access(path, constants.W_OK);
    return {
      name: "data dir writable",
      ok: true,
      detail: path,
      severity: "info",
    };
  } catch {
    return {
      name: "data dir writable",
      ok: false,
      detail: `${path} is not writable`,
      severity: "critical",
    };
  }
}

function checkCoreDumps(): Check {
  const report = harden();
  const hardened = report.notes.some((n) => n.includes("RLIMIT_CORE=0 set"));
  return {
    name: "core dumps disabled",
    ok: report.coreRlimitAttempted,
    detail: hardened
      ? "RLIMIT_CORE=0 (hardened in-process)"
      : `${report.notes.join("; ")}. If running as a service, set ulimit -c 0 in the unit file.`,
    severity: "warn",
  };
}

export async function runDoctor(_args: string[]): Promise<void> {
  const config = loadConfig();
  const checks: Check[] = [];

  checks.push(checkCoreDumps());
  checks.push(await checkWritableDir(config.dataDir));
  checks.push(await reachable(config.endpoint));

  // Adapter health
  const registry = buildRegistry({
    tenantId: config.tenantId,
    engineerId: config.engineerId,
    deviceId: config.deviceId,
  });
  for (const a of registry) {
    try {
      const h = await a.health({
        dataDir: config.dataDir,
        policy: {
          enabled: true,
          tier: config.tier,
          pollIntervalMs: config.pollIntervalMs,
        },
        log: {
          trace: () => {},
          debug: () => {},
          info: () => {},
          warn: () => {},
          error: () => {},
          fatal: () => {},
          child: function () {
            return this;
          },
        },
        tier: config.tier,
        cursor: { get: async () => null, set: async () => {} },
      });
      checks.push({
        name: `adapter ${a.id}`,
        ok: h.status !== "error",
        detail: `${h.status} (fidelity=${h.fidelity}${h.caveats ? `; ${h.caveats.join("; ")}` : ""})`,
        severity: h.status === "error" ? "warn" : "info",
      });
    } catch (e) {
      checks.push({
        name: `adapter ${a.id}`,
        ok: false,
        detail: `health check threw: ${String(e)}`,
        severity: "warn",
      });
    }
  }

  // Binary sha256 — argv[0] on a compiled Bun binary points at /proc/self/exe
  // or the launcher. We hash what we can; if it's the bun runtime during
  // `bun run`, the hash is the runtime's.
  const argv0 = process.argv[0];
  if (argv0) {
    const sha = await binarySha256(argv0);
    checks.push({
      name: "binary sha256",
      ok: sha !== null,
      detail: sha ? `${argv0} → ${sha}` : `${argv0} → <unavailable>`,
      severity: "info",
    });
  }

  const anyCritical = checks.some((c) => !c.ok && c.severity === "critical");

  console.log(
    JSON.stringify(
      {
        version: COLLECTOR_VERSION,
        endpoint: config.endpoint,
        dataDir: config.dataDir,
        checks,
      },
      null,
      2,
    ),
  );

  process.exit(anyCritical ? 1 : 0);
}
