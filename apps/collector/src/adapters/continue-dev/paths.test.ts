import { expect, test } from "bun:test";
import { join } from "node:path";
import {
  CONTINUE_DEV_DATA_SCHEMA_VERSION,
  CONTINUE_STREAM_NAMES,
  continueDevDataDir,
  continueGlobalDir,
  continueStreamPath,
} from "./paths";

test("CONTINUE_STREAM_NAMES is the D23-locked 4-tuple", () => {
  const expected: ReadonlyArray<(typeof CONTINUE_STREAM_NAMES)[number]> = [
    "chatInteraction",
    "editOutcome",
    "tokensGenerated",
    "toolUsage",
  ];
  expect([...CONTINUE_STREAM_NAMES].sort()).toEqual([...expected].sort());
});

test("BEMATIST_CONTINUE_DIR env override wins over everything", () => {
  const prevB = process.env.BEMATIST_CONTINUE_DIR;
  const prevC = process.env.CONTINUE_GLOBAL_DIR;
  try {
    process.env.BEMATIST_CONTINUE_DIR = "/tmp/bematist-override";
    process.env.CONTINUE_GLOBAL_DIR = "/tmp/continue-upstream";
    expect(continueGlobalDir()).toBe("/tmp/bematist-override");
  } finally {
    if (prevB === undefined) delete process.env.BEMATIST_CONTINUE_DIR;
    else process.env.BEMATIST_CONTINUE_DIR = prevB;
    if (prevC === undefined) delete process.env.CONTINUE_GLOBAL_DIR;
    else process.env.CONTINUE_GLOBAL_DIR = prevC;
  }
});

test("CONTINUE_GLOBAL_DIR env is honored when override is absent", () => {
  const prevB = process.env.BEMATIST_CONTINUE_DIR;
  const prevC = process.env.CONTINUE_GLOBAL_DIR;
  try {
    delete process.env.BEMATIST_CONTINUE_DIR;
    process.env.CONTINUE_GLOBAL_DIR = "/opt/continue";
    expect(continueGlobalDir()).toBe("/opt/continue");
  } finally {
    if (prevB === undefined) delete process.env.BEMATIST_CONTINUE_DIR;
    else process.env.BEMATIST_CONTINUE_DIR = prevB;
    if (prevC === undefined) delete process.env.CONTINUE_GLOBAL_DIR;
    else process.env.CONTINUE_GLOBAL_DIR = prevC;
  }
});

test("continueDevDataDir version-pins to the locked schema folder 0.2.0", () => {
  const prev = process.env.BEMATIST_CONTINUE_DIR;
  try {
    process.env.BEMATIST_CONTINUE_DIR = "/tmp/x";
    expect(continueDevDataDir()).toBe(join("/tmp/x", "dev_data", CONTINUE_DEV_DATA_SCHEMA_VERSION));
  } finally {
    if (prev === undefined) delete process.env.BEMATIST_CONTINUE_DIR;
    else process.env.BEMATIST_CONTINUE_DIR = prev;
  }
});

test("continueStreamPath returns `<baseDir>/dev_data/0.2.0/<stream>.jsonl`", () => {
  const prev = process.env.BEMATIST_CONTINUE_DIR;
  try {
    process.env.BEMATIST_CONTINUE_DIR = "/tmp/x";
    for (const name of CONTINUE_STREAM_NAMES) {
      expect(continueStreamPath(name)).toBe(join("/tmp/x", "dev_data", "0.2.0", `${name}.jsonl`));
    }
  } finally {
    if (prev === undefined) delete process.env.BEMATIST_CONTINUE_DIR;
    else process.env.BEMATIST_CONTINUE_DIR = prev;
  }
});
