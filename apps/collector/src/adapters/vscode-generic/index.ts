import type {
  Adapter,
  AdapterContext,
  AdapterHealth,
  EventEmitter,
  VSCodeDistro,
  VSCodeExtensionContext,
  VSCodeExtensionHandler,
} from "@bematist/sdk";
import { discoverProfiles, type VSCodeProfile } from "./discovery";
import { defaultHandlers } from "./handlers";

interface Identity {
  tenantId: string;
  engineerId: string;
  deviceId: string;
}

const DEFAULT_REDISCOVERY_MS = 60_000;

export interface VSCodeGenericAdapterOptions {
  /**
   * How long (ms) the cached profile list is trusted before `poll()` re-runs
   * `discoverProfiles()`. Defaults to 60s. Can also be overridden via
   * `BEMATIST_VSCODE_REDISCOVERY_MS`.
   */
  rediscoveryIntervalMs?: number;
  /** Test seam; defaults to `Date.now()`. */
  now?: () => number;
}

/**
 * VSCodeGenericAdapter — the +1 VS Code slot in the M2 adapter count
 * (CLAUDE.md §Adapter Matrix). This adapter doesn't pin a single extension;
 * instead it provides the registry + discovery shell that community
 * VS Code extension authors plug into via `VSCodeExtensionHandler`.
 *
 * One working example handler (`rjmacarthy.twinny`) ships in
 * `./handlers/twinny.ts` to prove the seam end-to-end.
 *
 * Per CLAUDE.md: honest fidelity. The adapter itself declares `"full"` only
 * when every registered handler reports full; otherwise the worst handler
 * wins. Community extensions usually land at `estimated`.
 */
export class VSCodeGenericAdapter implements Adapter {
  readonly id = "vscode-generic";
  readonly label = "VS Code extensions (generic)";
  readonly version = "0.1.0";
  readonly supportedSourceVersions = "*";

  private readonly handlers: VSCodeExtensionHandler[];
  private profiles: VSCodeProfile[] = [];
  private lastDiscoveryAt = 0;
  private readonly rediscoveryIntervalMs: number;
  private readonly now: () => number;

  constructor(
    identity: Identity,
    extra?: VSCodeExtensionHandler[],
    opts?: VSCodeGenericAdapterOptions,
  ) {
    this.handlers = [...defaultHandlers({ ...identity, tier: "B" }), ...(extra ?? [])];
    const envOverride = Number.parseInt(process.env.BEMATIST_VSCODE_REDISCOVERY_MS ?? "", 10);
    const ttl =
      opts?.rediscoveryIntervalMs ??
      (Number.isFinite(envOverride) && envOverride > 0 ? envOverride : DEFAULT_REDISCOVERY_MS);
    this.rediscoveryIntervalMs = ttl;
    this.now = opts?.now ?? (() => Date.now());
  }

  /**
   * Register an additional handler at runtime. Duplicate `extensionId`
   * replaces the prior entry so community handlers can override built-ins.
   */
  register(handler: VSCodeExtensionHandler): void {
    const idx = this.handlers.findIndex((h) => h.extensionId === handler.extensionId);
    if (idx >= 0) this.handlers[idx] = handler;
    else this.handlers.push(handler);
  }

  /** Inspection API — useful for `bematist status` and tests. */
  listHandlers(): ReadonlyArray<VSCodeExtensionHandler> {
    return this.handlers;
  }

  /** Inspection API for `bematist status` + tests — returns cached profiles. */
  listProfiles(): ReadonlyArray<VSCodeProfile> {
    return this.profiles;
  }

  async init(ctx: AdapterContext): Promise<void> {
    this.profiles = discoverProfiles();
    this.lastDiscoveryAt = this.now();
    ctx.log.info("vscode-generic: init", {
      profiles: this.profiles.map((p) => p.distro),
      handlers: this.handlers.map((h) => h.extensionId),
    });
  }

  async poll(ctx: AdapterContext, signal: AbortSignal, emit: EventEmitter): Promise<void> {
    this.maybeRediscover(ctx);
    if (this.profiles.length === 0) return;

    for (const profile of this.profiles) {
      for (const handler of this.handlers) {
        if (signal.aborted) return;
        const hCtx: VSCodeExtensionContext = {
          userDir: profile.userDir,
          distro: profile.distro,
          cursor: scopedCursor(ctx, profile.distro, handler.extensionId),
          log: ctx.log.child({ ext: handler.extensionId, distro: profile.distro }),
          tier: ctx.tier,
        };
        let paths: string[];
        try {
          paths = await handler.discover(hCtx);
        } catch (e) {
          ctx.log.warn("vscode-generic: handler.discover threw", {
            ext: handler.extensionId,
            err: String(e),
          });
          continue;
        }
        for (const p of paths) {
          if (signal.aborted) return;
          try {
            // Streaming: handler.parse emits per-event directly through our
            // emit callback, so events land in the journal per-file rather
            // than in a per-handler accumulator.
            await handler.parse(hCtx, p, signal, emit);
          } catch (e) {
            ctx.log.warn("vscode-generic: handler.parse threw", {
              ext: handler.extensionId,
              path: p,
              err: String(e),
            });
          }
        }
      }
    }
  }

  async health(_ctx: AdapterContext): Promise<AdapterHealth> {
    // Health is called by `bematist status` on demand; don't rerun discovery
    // on a short TTL here (poll is the authoritative driver), but DO fall
    // back to a fresh scan when we have nothing cached.
    const profiles = this.profiles.length > 0 ? this.profiles : discoverProfiles();
    if (profiles.length === 0) {
      return {
        status: "disabled",
        fidelity: "aggregate-only",
        caveats: ["No VS Code / Insiders / VSCodium profile discovered."],
      };
    }
    if (this.handlers.length === 0) {
      return {
        status: "disabled",
        fidelity: "aggregate-only",
        caveats: ["No VS Code extension handlers registered."],
      };
    }
    const fidelity = worstFidelity(this.handlers.map((h) => h.fidelity));
    const caveats = this.handlers.flatMap((h) => h.caveats ?? []);
    const base: AdapterHealth = { status: "ok", fidelity };
    if (caveats.length > 0) base.caveats = caveats;
    return base;
  }

  /**
   * Re-run `discoverProfiles()` if the cache is older than the TTL OR if
   * the cache is empty (fast-path first-poll case, e.g. when init() was
   * called before any distro dir existed). Logs at INFO when new profiles
   * appear, WARN when previously-seen profiles vanish. Existing cursors
   * for vanished distros are NOT wiped — a user who closes a VS Code window
   * mid-poll should see their session resume, not restart, on reopen.
   */
  private maybeRediscover(ctx: AdapterContext): void {
    const now = this.now();
    const stale = now - this.lastDiscoveryAt > this.rediscoveryIntervalMs;
    if (!stale && this.profiles.length > 0) return;

    const before = new Set(this.profiles.map((p) => p.distro));
    const next = discoverProfiles();
    this.profiles = next;
    this.lastDiscoveryAt = now;

    const after = new Set(next.map((p) => p.distro));
    const added = [...after].filter((d) => !before.has(d));
    const removed = [...before].filter((d) => !after.has(d));
    if (added.length > 0) {
      ctx.log.info("vscode-generic: new profile(s) discovered", { added });
    }
    if (removed.length > 0) {
      ctx.log.warn("vscode-generic: profile(s) vanished since last poll", {
        removed,
      });
    }
  }
}

function scopedCursor(
  ctx: AdapterContext,
  distro: VSCodeDistro,
  extensionId: string,
): AdapterContext["cursor"] {
  const prefix = `vscode:${distro}:${extensionId}:`;
  return {
    get: (k: string) => ctx.cursor.get(`${prefix}${k}`),
    set: (k: string, v: string) => ctx.cursor.set(`${prefix}${k}`, v),
  };
}

const FIDELITY_RANK = {
  full: 3,
  estimated: 2,
  "post-migration": 1,
  "aggregate-only": 0,
} as const;

function worstFidelity(
  values: ReadonlyArray<AdapterHealth["fidelity"]>,
): AdapterHealth["fidelity"] {
  if (values.length === 0) return "aggregate-only";
  let worst: AdapterHealth["fidelity"] = values[0] ?? "aggregate-only";
  for (const v of values) {
    if (FIDELITY_RANK[v] < FIDELITY_RANK[worst]) worst = v;
  }
  return worst;
}

export type { VSCodeProfile } from "./discovery";
export { discoverProfiles } from "./discovery";
export { defaultHandlers, makeTwinnyHandler } from "./handlers";
