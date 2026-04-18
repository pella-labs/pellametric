import type { Adapter } from "@bematist/sdk";
import { ClaudeCodeAdapter } from "./claude-code";
import { CodexAdapter } from "./codex";
import { CursorAdapter } from "./cursor";
import { OpenCodeAdapter } from "./opencode";

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
  return [
    new ClaudeCodeAdapter(id),
    new CodexAdapter(id),
    new CursorAdapter(id),
    new OpenCodeAdapter(id),
  ];
}
