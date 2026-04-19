#!/usr/bin/env bun
// GitHub fixture recorder — PRD §13 Phase G0 tool.
//
// Usage (from repo root):
//
//   cat /tmp/payload.json \
//     | bun run fixtures:github:record --event pull_request --scenario opened
//
//   gh api /repos/OWNER/REPO/hooks/HOOK_ID/deliveries/DELIVERY_ID \
//     | bun run fixtures:github:record --event push --scenario regular
//
// What it does:
//
//   1. Read the raw JSON payload from stdin (must parse as a JSON object).
//   2. Run the same redaction ruleset as the CI gate
//      (packages/fixtures/src/github/redactCheck.ts). Any offense → exit 2.
//   3. Canonicalize the JSON (`JSON.stringify(value, null, 2) + "\n"`)
//      and compute `X-Hub-Signature-256` over those exact bytes.
//   4. Write the payload to `packages/fixtures/github/<event>/<scenario>.json`
//      and the headers sidecar to `<event>/<scenario>.headers.json`.
//
// When `gh api deliveries/:id` is the source, its response shape is
// `{request: {payload, headers}, ...}`. We auto-detect that envelope and
// extract `request.payload` — otherwise the input is treated as the raw
// webhook body verbatim.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { redactionCheck } from "./redactCheck";
import { computeHubSignature256, readFixtureSecret } from "./sign";

interface Args {
  event: string;
  scenario: string;
  deliveryId?: string;
  fixturesRoot?: string;
}

function nextArg(argv: string[], i: number): string {
  const v = argv[i];
  if (v === undefined) {
    process.stderr.write("fixtures:github:record — missing value for option\n");
    process.exit(2);
  }
  return v;
}

function parseArgs(argv: string[]): Args {
  const out: Partial<Args> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--event") out.event = nextArg(argv, ++i);
    else if (a === "--scenario") out.scenario = nextArg(argv, ++i);
    else if (a === "--delivery-id") out.deliveryId = nextArg(argv, ++i);
    else if (a === "--fixtures-root") out.fixturesRoot = nextArg(argv, ++i);
    else if (a === "--help" || a === "-h") {
      process.stdout.write(HELP);
      process.exit(0);
    }
  }
  if (!out.event || !out.scenario) {
    process.stderr.write("fixtures:github:record — --event and --scenario are required\n\n");
    process.stderr.write(HELP);
    process.exit(2);
  }
  return out as Args;
}

const HELP = `usage: bun run fixtures:github:record \\
         --event <name> --scenario <name> \\
         [--delivery-id <uuid>] [--fixtures-root <path>]

Reads a GitHub webhook payload from stdin and writes:

  packages/fixtures/github/<event>/<scenario>.json
  packages/fixtures/github/<event>/<scenario>.headers.json

The sidecar contains X-GitHub-Event, X-GitHub-Delivery, and a
deterministically computed X-Hub-Signature-256 using the repo-committed
fixture secret at packages/fixtures/github/.webhook-secret.

Options:
  --event        GitHub event name (pull_request, push, check_suite, ...)
  --scenario     Scenario slug (opened, closed-merged-squash, forced, ...)
  --delivery-id  Override X-GitHub-Delivery (default: stable fixture UUID)
  --fixtures-root Override fixtures root (default: packages/fixtures)
`;

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Detect the `gh api deliveries/:id` envelope and unwrap it; otherwise pass
 * the body through. Real GitHub webhooks never carry a top-level `request`
 * key, so the heuristic is safe.
 */
function unwrapGhApiEnvelope(parsed: unknown): unknown {
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const obj = parsed as Record<string, unknown>;
    if (
      obj.request &&
      typeof obj.request === "object" &&
      (obj.request as Record<string, unknown>).payload !== undefined
    ) {
      return (obj.request as Record<string, unknown>).payload;
    }
  }
  return parsed;
}

function deterministicDeliveryId(event: string, scenario: string): string {
  // Not a real UUID — prefixed fixture shape that makes logs readable and
  // Redis SETNX keys reproducible across test runs.
  return `fixture-${event}-${scenario}`;
}

function fixturesRootFromCwd(override?: string): string {
  if (override) return resolve(override);
  // Invoked from repo root via `bun run fixtures:github:record` — resolve
  // relative to the fixtures package directory.
  return resolve(import.meta.dir, "..", "..");
}

export interface RecordInput {
  event: string;
  scenario: string;
  rawBody: string;
  deliveryId?: string;
  fixturesRoot: string;
}

export interface RecordOutput {
  payloadPath: string;
  headersPath: string;
  signature: string;
  deliveryId: string;
}

/**
 * Canonicalize + sign + write. Exported so in-process callers (e.g. the
 * smoke-test script in G1) can re-use this without shelling out.
 */
export function record(input: RecordInput): RecordOutput {
  const parsed = unwrapGhApiEnvelope(JSON.parse(input.rawBody));
  const { ok, offenses } = redactionCheck(parsed);
  if (!ok) {
    const msg = `fixtures:github:record — redaction rejected payload:\n  ${offenses.join("\n  ")}\n`;
    process.stderr.write(msg);
    process.exit(2);
  }
  // Canonicalize: pretty-printed JSON + trailing newline, matching the
  // repo-committed shape. HMAC is over these exact bytes.
  const canonical = `${JSON.stringify(parsed, null, 2)}\n`;

  const secret = readFixtureSecret(input.fixturesRoot);
  const signature = computeHubSignature256(canonical, secret);
  const deliveryId = input.deliveryId ?? deterministicDeliveryId(input.event, input.scenario);

  const payloadPath = resolve(input.fixturesRoot, "github", input.event, `${input.scenario}.json`);
  const headersPath = resolve(
    input.fixturesRoot,
    "github",
    input.event,
    `${input.scenario}.headers.json`,
  );

  mkdirSync(dirname(payloadPath), { recursive: true });
  writeFileSync(payloadPath, canonical, "utf8");
  writeFileSync(
    headersPath,
    `${JSON.stringify(
      {
        "X-GitHub-Event": input.event,
        "X-GitHub-Delivery": deliveryId,
        "X-Hub-Signature-256": signature,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  return { payloadPath, headersPath, signature, deliveryId };
}

// CLI entrypoint — only runs when executed directly, not on import.
if (import.meta.main) {
  const args = parseArgs(process.argv.slice(2));
  const rawBody = await readStdin();
  if (!rawBody.trim()) {
    process.stderr.write("fixtures:github:record — empty stdin\n");
    process.exit(2);
  }
  const fixturesRoot = fixturesRootFromCwd(args.fixturesRoot);
  const res = record({
    event: args.event,
    scenario: args.scenario,
    rawBody,
    ...(args.deliveryId !== undefined ? { deliveryId: args.deliveryId } : {}),
    fixturesRoot,
  });
  process.stdout.write(
    `wrote ${res.payloadPath}\nwrote ${res.headersPath}\n  delivery: ${res.deliveryId}\n  signature: ${res.signature}\n`,
  );
}
