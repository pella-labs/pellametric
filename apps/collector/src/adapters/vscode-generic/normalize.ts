import { createHash } from "node:crypto";
import type { Event } from "@bematist/schema";

export interface ServerIdentity {
  tenantId: string;
  engineerId: string;
  deviceId: string;
  tier: "A" | "B" | "C";
}

/**
 * Deterministic UUID v4 derived from `sha256(extensionId|sessionId|seq|kind|payload)`
 * so replaying the same handler over the same input yields identical
 * `client_event_id` values — the idempotency guarantee from contract 03.
 */
export function deterministicEventId(
  extensionId: string,
  sessionId: string,
  seq: number,
  kind: string,
  payload: unknown,
): string {
  const raw = `vscode:${extensionId}|${sessionId}|${seq}|${kind}|${JSON.stringify(payload)}`;
  const hex = createHash("sha256").update(raw).digest("hex");
  return [
    hex.substring(0, 8),
    hex.substring(8, 12),
    `4${hex.substring(12, 15)}`,
    `${((Number.parseInt(hex.substring(15, 16), 16) & 0x3) | 0x8).toString(16)}${hex.substring(16, 19)}`,
    hex.substring(19, 31),
  ].join("-");
}

export interface BaseEventArgs {
  id: ServerIdentity;
  sessionId: string;
  seq: number;
  ts: string;
  sourceVersion?: string;
  fidelity: Event["fidelity"];
  costEstimated?: boolean;
}

/**
 * Shared constructor for the envelope fields every `vscode-generic` event
 * carries. Handlers build on top of this and only fill in `gen_ai` /
 * `dev_metrics`.
 */
export function baseEvent(args: BaseEventArgs): Omit<Event, "client_event_id" | "dev_metrics"> {
  const base: Omit<Event, "client_event_id" | "dev_metrics"> = {
    schema_version: 1,
    ts: args.ts,
    tenant_id: args.id.tenantId,
    engineer_id: args.id.engineerId,
    device_id: args.id.deviceId,
    source: "vscode-generic",
    fidelity: args.fidelity,
    cost_estimated: args.costEstimated ?? false,
    tier: args.id.tier,
    session_id: args.sessionId,
    event_seq: args.seq,
  };
  if (args.sourceVersion !== undefined) base.source_version = args.sourceVersion;
  return base;
}
