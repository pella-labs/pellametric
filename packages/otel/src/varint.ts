// Tiny proto3 wire-format helpers — kept ONLY for test fixtures.
//
// The production decode path is now @bufbuild/protobuf + generated bindings
// (see `./decode_proto.ts` and `./decode_json.ts`). These helpers stay around
// because the map.test.ts fixtures hand-build minimal ExportTraceServiceRequest
// binaries rather than depending on the generated `create()` factory — keeping
// the fixtures self-describing (every byte is visible in the test file).
//
// If you're writing NEW code against OTLP messages, use `create()` +
// `toBinary()` from @bufbuild/protobuf and the schemas in `./gen/` instead.

export class OtlpEncodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OtlpEncodeError";
  }
}

const WIRE_VARINT = 0;
const WIRE_64BIT = 1;
const WIRE_LEN = 2;

export function encodeVarint(value: number): Uint8Array {
  if (value < 0 || !Number.isFinite(value)) {
    throw new OtlpEncodeError("encodeVarint: negative or non-finite");
  }
  const out: number[] = [];
  let v = value;
  while (v >= 0x80) {
    out.push((v & 0x7f) | 0x80);
    v = Math.floor(v / 128);
  }
  out.push(v & 0x7f);
  return Uint8Array.from(out);
}

export function encodeTag(fieldNumber: number, wireType: number): Uint8Array {
  return encodeVarint((fieldNumber << 3) | wireType);
}

export function encodeLengthDelimited(fieldNumber: number, payload: Uint8Array): Uint8Array {
  const tag = encodeTag(fieldNumber, WIRE_LEN);
  const len = encodeVarint(payload.length);
  const out = new Uint8Array(tag.length + len.length + payload.length);
  out.set(tag, 0);
  out.set(len, tag.length);
  out.set(payload, tag.length + len.length);
  return out;
}

export function encodeString(fieldNumber: number, value: string): Uint8Array {
  return encodeLengthDelimited(fieldNumber, new TextEncoder().encode(value));
}

export function encodeBytes(fieldNumber: number, value: Uint8Array): Uint8Array {
  return encodeLengthDelimited(fieldNumber, value);
}

export function encodeVarintField(fieldNumber: number, value: number): Uint8Array {
  const tag = encodeTag(fieldNumber, WIRE_VARINT);
  const v = encodeVarint(value);
  const out = new Uint8Array(tag.length + v.length);
  out.set(tag, 0);
  out.set(v, tag.length);
  return out;
}

export function encodeFixed64(fieldNumber: number, value: bigint | number): Uint8Array {
  const tag = encodeTag(fieldNumber, WIRE_64BIT);
  const out = new Uint8Array(tag.length + 8);
  out.set(tag, 0);
  const dv = new DataView(out.buffer, tag.length, 8);
  dv.setBigUint64(0, typeof value === "bigint" ? value : BigInt(value), true);
  return out;
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}
