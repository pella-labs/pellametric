// node-redis-backed WalRedis adapter (Sprint-1 follow-up A).
//
// Implements the narrow `WalRedis` interface from append.ts using node-redis
// v4's streams commands: xAdd, xReadGroup, xAck, xClaim, xGroupCreate, xLen,
// xInfoGroups.
//
// We REUSE the shared node-redis client created by
// `createSharedNodeRedisClient` in ./auth/nodeRedisLua.ts so the process
// holds a single connection for Lua scripts + streams.

import type { NodeRedisClient } from "../auth/nodeRedisLua";
import type { WalRedis } from "./append";

export function createRedisStreamsWal(redis: NodeRedisClient): WalRedis {
  return {
    async xadd(stream: string, fields: Record<string, string>): Promise<string> {
      // node-redis v4 signature: xAdd(key, id, message, options?)
      // id="*" — let Redis assign. message is an object of string fields.
      const id = await redis.xAdd(stream, "*", fields);
      return id as string;
    },

    async xreadgroup(
      group: string,
      consumer: string,
      stream: string,
      fromId: string,
      opts: { count: number; blockMs: number },
    ): Promise<Array<{ id: string; fields: Record<string, string> }>> {
      // node-redis v4 signature: xReadGroup(group, consumer, streams, options)
      // Returns: null | Array<{ name, messages: Array<{ id, message }> }>
      const reply = await redis.xReadGroup(group, consumer, [{ key: stream, id: fromId }], {
        COUNT: opts.count,
        BLOCK: opts.blockMs,
      });
      if (!reply) return [];
      const out: Array<{ id: string; fields: Record<string, string> }> = [];
      for (const s of reply) {
        const msgs = (s as { messages?: Array<{ id: string; message: Record<string, string> }> })
          .messages;
        if (!msgs) continue;
        for (const m of msgs) {
          out.push({ id: m.id, fields: m.message });
        }
      }
      return out;
    },

    async xack(stream: string, group: string, ids: string[]): Promise<number> {
      if (ids.length === 0) return 0;
      const n = await redis.xAck(stream, group, ids);
      return Number(n);
    },

    async xclaim(
      stream: string,
      group: string,
      consumer: string,
      minIdleMs: number,
      ids: string[],
    ): Promise<Array<{ id: string; fields: Record<string, string> }>> {
      if (ids.length === 0) return [];
      const reply = await redis.xClaim(stream, group, consumer, minIdleMs, ids);
      if (!Array.isArray(reply)) return [];
      return (reply as Array<{ id: string; message: Record<string, string> }>).map((m) => ({
        id: m.id,
        fields: m.message,
      }));
    },

    async xgroupCreate(
      stream: string,
      group: string,
      startId: string,
      opts: { mkstream: boolean },
    ): Promise<void> {
      try {
        // node-redis v4: xGroupCreate(key, group, id, options?)
        await redis.xGroupCreate(stream, group, startId, { MKSTREAM: opts.mkstream });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // BUSYGROUP = group already exists. Consumer.ensureGroup() also catches
        // this upstream, but we swallow here too so callers can call direct.
        if (/BUSYGROUP/.test(msg)) return;
        throw err;
      }
    },

    async xlen(stream: string): Promise<number> {
      const n = await redis.xLen(stream);
      return Number(n);
    },

    async xinfoGroupsPending(stream: string, group: string): Promise<number> {
      // xInfoGroups returns an array of group info objects; each entry has
      // shape `{ name, consumers, pending, ...}`. We filter by name.
      let reply: unknown;
      try {
        reply = await redis.xInfoGroups(stream);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // If the stream doesn't exist yet (pre-first-XADD), return 0.
        if (/no such key|ERR.*stream/i.test(msg)) return 0;
        throw err;
      }
      if (!Array.isArray(reply)) return 0;
      for (const g of reply as Array<{ name: string; pending: number | string }>) {
        if (g.name === group) return Number(g.pending);
      }
      return 0;
    },
  };
}
