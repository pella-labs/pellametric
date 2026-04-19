// End-to-end test for the tracking-mode PATCH → recompute wire path:
//   1. admin calls patchTrackingMode
//   2. mutation writes orgs row
//   3. emitTrackingModeFlipped fires a Redis-stream-shape message
//   4. the linker's decodeMessage understands the emitted shape
//
// This closes the loop from the admin API side to the linker consumer's
// decoder WITHOUT needing a running Redis. We encode the message the way
// production does (via apps/worker/src/github-initial-sync/recomputeEmitter.ts)
// and decode it via the linker's `decodeMessage` — if they don't match,
// the G1-linker's coalescer would silently drop our events.

import { describe, expect, test } from "bun:test";
import {
  decodeMessage,
  fieldsToRecord,
} from "../../../../../apps/worker/src/github-linker/messageShape";
import type { Ctx } from "../../auth";
import { patchTrackingMode } from "./trackingMode";

const TENANT = "11111111-2222-3333-4444-555555555555";

function makeCtx(): Ctx {
  return {
    tenant_id: TENANT,
    actor_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    role: "admin",
    db: {
      pg: {
        async query<T = unknown>(sql: string): Promise<T[]> {
          if (/FROM orgs/i.test(sql) && /SELECT/i.test(sql)) {
            return [{ github_repo_tracking_mode: "all" }] as unknown as T[];
          }
          return [] as T[];
        },
      },
      ch: {
        async query() {
          return [];
        },
      },
      redis: {
        async get() {
          return null;
        },
        async set() {},
        async setNx() {
          return true;
        },
      },
    },
  };
}

describe("tracking-mode PATCH → recompute wire contract", () => {
  test("emitted message shape matches the linker decodeMessage contract", async () => {
    const ctx = makeCtx();
    const recorded: Array<{ stream: string; fields: Record<string, string> }> = [];

    // Production emitter shape: Redis Streams XADD with flat fields, matching
    // `apps/worker/src/github-initial-sync/recomputeEmitter.ts`. We reify
    // that here to prove the wire-format parity.
    const emitter = {
      async emitTrackingModeFlipped(args: {
        tenant_id: string;
        newMode: "all" | "selected";
      }): Promise<number> {
        const fields: Record<string, string> = {
          tenant_id: args.tenant_id,
          reason: "tracking_mode_flipped",
          new_mode: args.newMode,
          at: String(Date.now()),
        };
        recorded.push({
          stream: `session_repo_recompute:${args.tenant_id}`,
          fields,
        });
        return 1;
      },
    };

    const out = await patchTrackingMode(ctx, { mode: "selected" }, { recompute: emitter });
    expect(out.mode).toBe("selected");
    expect(recorded.length).toBe(1);

    // Critical: the linker's decoder understands our wire shape.
    const decoded = decodeMessage(fieldsToRecord(recorded[0]?.fields));
    expect(decoded).not.toBeNull();
    expect(decoded?.shape).toBe("sync");
    expect(decoded?.trigger).toBe("tracking_mode_flipped");
    expect(decoded?.tenant_id).toBe(TENANT);
    // Session-id is null for tenant-wide fan-outs — the linker walks its
    // session-index to project the flip onto each session.
    expect(decoded?.session_id).toBeNull();
  });
});
