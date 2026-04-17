// KeyValue / AnyValue accessors for OTel attributes.
//
// Attribute lookup is per-key linear scan; OTel attribute lists are short
// (single digits per Resource/Span/LogRecord), so this beats building a Map
// per access — and avoids surprising the GC during request handling.

import type { AnyValue, KeyValue } from "./types";

export function getAttr(attrs: KeyValue[] | undefined, key: string): AnyValue | undefined {
  if (!attrs) return undefined;
  for (const kv of attrs) {
    if (kv.key === key) return kv.value;
  }
  return undefined;
}

export function getAttrString(attrs: KeyValue[] | undefined, key: string): string | undefined {
  const v = getAttr(attrs, key);
  if (!v) return undefined;
  if (typeof v.stringValue === "string") return v.stringValue;
  return undefined;
}

export function getAttrBool(attrs: KeyValue[] | undefined, key: string): boolean | undefined {
  const v = getAttr(attrs, key);
  if (!v) return undefined;
  if (typeof v.boolValue === "boolean") return v.boolValue;
  return undefined;
}

export function getAttrInt(attrs: KeyValue[] | undefined, key: string): number | undefined {
  const v = getAttr(attrs, key);
  if (!v) return undefined;
  if (typeof v.intValue === "number") return v.intValue;
  if (typeof v.intValue === "string") {
    const n = Number(v.intValue);
    return Number.isFinite(n) ? n : undefined;
  }
  // Some emitters put numeric usage counts into doubleValue.
  if (typeof v.doubleValue === "number") return Math.trunc(v.doubleValue);
  return undefined;
}

export function getAttrDouble(attrs: KeyValue[] | undefined, key: string): number | undefined {
  const v = getAttr(attrs, key);
  if (!v) return undefined;
  if (typeof v.doubleValue === "number") return v.doubleValue;
  if (typeof v.intValue === "number") return v.intValue;
  if (typeof v.intValue === "string") {
    const n = Number(v.intValue);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function anyValueToJs(v: AnyValue): unknown {
  if (typeof v.stringValue === "string") return v.stringValue;
  if (typeof v.boolValue === "boolean") return v.boolValue;
  if (typeof v.intValue === "number") return v.intValue;
  if (typeof v.intValue === "string") {
    const n = Number(v.intValue);
    return Number.isFinite(n) ? n : v.intValue;
  }
  if (typeof v.doubleValue === "number") return v.doubleValue;
  if (v.arrayValue) return v.arrayValue.values.map(anyValueToJs);
  if (v.kvlistValue) {
    const out: Record<string, unknown> = {};
    for (const kv of v.kvlistValue.values) out[kv.key] = anyValueToJs(kv.value);
    return out;
  }
  if (typeof v.bytesValue === "string") return v.bytesValue;
  return null;
}

export function attrsToRecord(attrs: KeyValue[] | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!attrs) return out;
  for (const kv of attrs) out[kv.key] = anyValueToJs(kv.value);
  return out;
}
