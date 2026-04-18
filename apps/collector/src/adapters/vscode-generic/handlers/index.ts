import type { VSCodeExtensionHandler } from "@bematist/sdk";
import type { ServerIdentity } from "../normalize";
import { makeTwinnyHandler } from "./twinny";

export { makeTwinnyHandler };

/**
 * Built-in handlers shipped with the collector. Community-authored handlers
 * should be registered via `VSCodeGenericAdapter.register()`.
 */
export function defaultHandlers(identity: ServerIdentity): VSCodeExtensionHandler[] {
  return [makeTwinnyHandler(identity)];
}
