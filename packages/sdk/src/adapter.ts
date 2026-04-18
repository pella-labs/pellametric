import type { Event } from "@bematist/schema";

// Source of truth: contracts/03-adapter-sdk.md. Shapes copied verbatim.
// Any discrepancy with the contract is a bug — fix the contract first.

export interface AdapterContext {
  /** Per-machine writable dir, ~/.bematist/adapters/<id>/ */
  dataDir: string;
  /** Resolved policy for this adapter (tier, redaction overrides). */
  policy: AdapterPolicy;
  /** Logger; pino-compatible. */
  log: Logger;
  /** Current effective tier for THIS adapter (may differ from collector default). */
  tier: "A" | "B" | "C";
  /** Stable cursor store: per-source resumable read offsets. */
  cursor: CursorStore;
}

export interface AdapterPolicy {
  enabled: boolean;
  tier: "A" | "B" | "C";
  pollIntervalMs: number;
  redactionOverrides?: Record<string, "drop" | "hash" | "keep">;
}

export interface CursorStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

export interface AdapterHealth {
  status: "ok" | "degraded" | "error" | "disabled";
  lastEventAt?: Date;
  lastErrorAt?: Date;
  lastError?: string;
  /** Honest data-fidelity tag — surfaces in dashboard pickers. */
  fidelity: "full" | "estimated" | "aggregate-only" | "post-migration";
  /** Per-source caveats, e.g. "Cursor Auto-mode → cost_estimated=true". */
  caveats?: string[];
}

/**
 * Alias for AdapterHealth — the B-seed task spec calls this "AdapterStatus".
 * The contract (03-adapter-sdk.md) names it AdapterHealth; both names point
 * at the same shape. Prefer AdapterHealth in new code.
 */
export type AdapterStatus = AdapterHealth;

export interface Adapter {
  /** Unique stable id, e.g. "claude-code", "cursor", "continue". */
  readonly id: string;
  /** Human label for UI. */
  readonly label: string;
  /** Semver of the adapter implementation, NOT the source app. */
  readonly version: string;
  /** Source app version range this adapter knows how to read. */
  readonly supportedSourceVersions: string;

  /** One-time setup. Validate paths, create cursors, etc. Throw to disable. */
  init(ctx: AdapterContext): Promise<void>;

  /** Called every `pollIntervalMs`. Returns events to enqueue.
   *  MUST be cancellation-safe: if the collector aborts mid-poll, no partial state. */
  poll(ctx: AdapterContext, signal: AbortSignal): Promise<Event[]>;

  /** Cheap health check — populates `bematist status` and dashboard. */
  health(ctx: AdapterContext): Promise<AdapterHealth>;

  /** Optional — graceful shutdown hook. */
  shutdown?(ctx: AdapterContext): Promise<void>;
}

// Minimal pino-compatible surface; packages/sdk stays free of a pino dep
// so @bematist/sdk can be consumed by both the collector and tests without
// pulling a logger runtime.
export interface Logger {
  trace(msg: string, ...args: unknown[]): void;
  debug(msg: string, ...args: unknown[]): void;
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
  fatal(msg: string, ...args: unknown[]): void;
  child(bindings: Record<string, unknown>): Logger;
}

// ────────────────────────────────────────────────────────────────────────────
// VS Code generic extension seam (A5) — additive.
//
// Community authors who want to ship a Bematist adapter for their VS Code
// extension implement `VSCodeExtensionHandler` and register it via
// `registerVSCodeExtension()`. The generic adapter walks every discovered VS
// Code profile (Code / Code - Insiders / VSCodium / Cursor-VSC-lineage) and
// delegates all per-extension work to the handler.
//
// Scope cap: A5 is the seam + one worked example. The Phase-2 "full" VS Code
// targets (Cline/Roo/Kilo, Copilot IDE, Antigravity) get their own top-level
// adapters — NOT handler registrations here. See CLAUDE.md §Adapter Matrix.
// ────────────────────────────────────────────────────────────────────────────

export type VSCodeDistro = "code" | "code-insiders" | "vscodium" | "codium";

export interface VSCodeExtensionContext {
  /** Absolute path of the discovered VS Code profile root (the `User/` dir). */
  userDir: string;
  /** Which distro fork the path belongs to. Handlers may opt in/out per fork. */
  distro: VSCodeDistro;
  /** Resolved cursor store for this (adapter, profile, extension) triple. */
  cursor: CursorStore;
  log: Logger;
  tier: "A" | "B" | "C";
}

export interface VSCodeExtensionHandler {
  /** Publisher-qualified id, e.g. "rjmacarthy.twinny". Used as cursor key prefix. */
  readonly extensionId: string;
  /** Human label for the dashboard `data_fidelity` chip. */
  readonly label: string;
  /** Honest fidelity per CLAUDE.md §Adapter Matrix. */
  readonly fidelity: "full" | "estimated" | "aggregate-only" | "post-migration";
  /** Handler semver — independent of source extension version. */
  readonly version: string;
  /** Optional caveats surfaced in `health()`. */
  readonly caveats?: readonly string[];

  /**
   * Return candidate data-file paths for this extension under the given
   * profile. MUST be pure (read filesystem OK, no writes). Returning an empty
   * array is a valid "nothing here yet" signal.
   */
  discover(ctx: VSCodeExtensionContext): Promise<string[]>;

  /**
   * Normalize one discovered file to canonical `Event[]`. The handler is
   * responsible for respecting `ctx.cursor` to support resumable polling.
   * Implementations MUST be cancellation-safe under `signal.aborted`.
   */
  parse(
    ctx: VSCodeExtensionContext,
    filePath: string,
    signal: AbortSignal,
  ): Promise<import("@bematist/schema").Event[]>;
}
