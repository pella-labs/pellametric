// Forbidden-field guard (contract 06 §Forbidden fields).
//
// Client-side enforcement: refuse to emit an Event whose attributes carry any
// of `FORBIDDEN_FIELDS`. The same check runs server-side at ingest (HTTP 400);
// this is defense-in-depth — if the collector slips, the server catches.

import { FORBIDDEN_FIELDS, type ForbiddenField } from "./types";

export class ForbiddenFieldError extends Error {
  readonly field: ForbiddenField;
  readonly path: string;
  constructor(field: ForbiddenField, path: string) {
    super(`clio: forbidden field '${field}' present at '${path}'`);
    this.name = "ForbiddenFieldError";
    this.field = field;
    this.path = path;
  }
}

/**
 * Walk `value` and throw if any key matches `FORBIDDEN_FIELDS`. Arrays are
 * recursed into; only plain objects have their keys checked.
 *
 * Depth is capped at 32 to prevent adversarial self-referential payloads from
 * producing unbounded work — real event attributes are shallow.
 */
export function assertNoForbiddenFields(value: unknown, path = "$", depth = 0): void {
  if (depth > 32) return;
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      assertNoForbiddenFields(value[i], `${path}[${i}]`, depth + 1);
    }
    return;
  }
  const obj = value as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if ((FORBIDDEN_FIELDS as readonly string[]).includes(key)) {
      throw new ForbiddenFieldError(key as ForbiddenField, `${path}.${key}`);
    }
    assertNoForbiddenFields(obj[key], `${path}.${key}`, depth + 1);
  }
}

/** Non-throwing variant — returns the first offending field/path, or null. */
export function findForbiddenField(value: unknown): { field: ForbiddenField; path: string } | null {
  try {
    assertNoForbiddenFields(value);
    return null;
  } catch (err) {
    if (err instanceof ForbiddenFieldError) {
      return { field: err.field, path: err.path };
    }
    throw err;
  }
}
