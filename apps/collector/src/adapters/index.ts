import type { Adapter } from "@bematist/sdk";
import { ClaudeCodeAdapter } from "./claude-code";

export interface RegistryIdentity {
  tenantId: string;
  engineerId: string;
  deviceId: string;
}

/**
 * Static registration of every v1 adapter.
 * M1 ships only claude-code; M2 adds codex / cursor / opencode / continue / vscode-generic.
 */
export function buildRegistry(id: RegistryIdentity): Adapter[] {
  return [new ClaudeCodeAdapter(id)];
}
