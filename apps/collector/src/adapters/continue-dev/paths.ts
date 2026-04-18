import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Continue.dev writes four JSONL streams to `~/.continue/dev_data/0.2.0/`.
 * `CONTINUE_GLOBAL_DIR` overrides the base (`~/.continue`); mirrors the env
 * var the upstream project uses. `BEMATIST_CONTINUE_DIR` is a test hook that
 * takes precedence over everything else.
 *
 * Schema folder `0.2.0` matches the Continue telemetry schema version as of
 * v1.x; newer dev-data versions live under their own folder, so this adapter
 * version-pins to `0.2.0` and explicitly does not fall back silently.
 */
export const CONTINUE_DEV_DATA_SCHEMA_VERSION = "0.2.0";

export const CONTINUE_STREAM_NAMES = [
  "chatInteraction",
  "tokensGenerated",
  "editOutcome",
  "toolUsage",
] as const;

export type ContinueStreamName = (typeof CONTINUE_STREAM_NAMES)[number];

export function continueGlobalDir(): string {
  const override = process.env.BEMATIST_CONTINUE_DIR;
  if (override && override.length > 0) return override;
  const base = process.env.CONTINUE_GLOBAL_DIR;
  if (base && base.length > 0) return base;
  return join(homedir(), ".continue");
}

export function continueDevDataDir(): string {
  return join(continueGlobalDir(), "dev_data", CONTINUE_DEV_DATA_SCHEMA_VERSION);
}

export function continueStreamPath(stream: ContinueStreamName): string {
  return join(continueDevDataDir(), `${stream}.jsonl`);
}
