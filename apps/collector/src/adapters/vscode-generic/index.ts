import type { Event } from "@bematist/schema";
import type {
  Adapter,
  AdapterContext,
  AdapterHealth,
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

  constructor(identity: Identity, extra?: VSCodeExtensionHandler[]) {
    this.handlers = [...defaultHandlers({ ...identity, tier: "B" }), ...(extra ?? [])];
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

  async init(ctx: AdapterContext): Promise<void> {
    this.profiles = discoverProfiles();
    ctx.log.info("vscode-generic: init", {
      profiles: this.profiles.map((p) => p.distro),
      handlers: this.handlers.map((h) => h.extensionId),
    });
  }

  async poll(ctx: AdapterContext, signal: AbortSignal): Promise<Event[]> {
    if (this.profiles.length === 0) this.profiles = discoverProfiles();
    if (this.profiles.length === 0) return [];

    const all: Event[] = [];
    for (const profile of this.profiles) {
      for (const handler of this.handlers) {
        if (signal.aborted) return all;
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
          if (signal.aborted) return all;
          try {
            const events = await handler.parse(hCtx, p, signal);
            all.push(...events);
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
    return all;
  }

  async health(_ctx: AdapterContext): Promise<AdapterHealth> {
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
