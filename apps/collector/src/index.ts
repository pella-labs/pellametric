#!/usr/bin/env bun
// Bematist — per-machine collector entrypoint.
//
// This module is the `bun build --compile` target. It delegates to the CLI
// so `bematist` and `bun src/index.ts` behave identically.
//
// Library exports live at the bottom so tests (and a potential future
// `@bematist/collector` import path) can reuse the loop / config / adapters.

import "./cli";

export { buildRegistry } from "./adapters";
export { COLLECTOR_VERSION, type CollectorConfig, loadConfig } from "./config";
export { EgressLog, type EgressLogEntry } from "./egress/egressLog";
export { type FlushOptions, type FlushResult, flushBatch } from "./egress/flush";
export { isRetryableStatus, postWithRetry } from "./egress/httpClient";
export { Journal } from "./egress/journal";
export { type LoopDeps, type LoopHandle, startLoop } from "./loop";
