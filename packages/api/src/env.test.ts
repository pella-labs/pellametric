import { afterEach, describe, expect, test } from "bun:test";
import { isComplianceEnabled } from "./env";

const KEY = "BEMATIST_COMPLIANCE_ENABLED";

afterEach(() => {
  delete process.env[KEY];
});

describe("isComplianceEnabled", () => {
  test("unset → false (demo default)", () => {
    delete process.env[KEY];
    expect(isComplianceEnabled()).toBe(false);
  });

  test('"true" → true', () => {
    process.env[KEY] = "true";
    expect(isComplianceEnabled()).toBe(true);
  });

  test('"1" → true', () => {
    process.env[KEY] = "1";
    expect(isComplianceEnabled()).toBe(true);
  });

  test('"false" → false', () => {
    process.env[KEY] = "false";
    expect(isComplianceEnabled()).toBe(false);
  });

  test('"0" → false', () => {
    process.env[KEY] = "0";
    expect(isComplianceEnabled()).toBe(false);
  });

  test("empty string → false", () => {
    process.env[KEY] = "";
    expect(isComplianceEnabled()).toBe(false);
  });

  test("any other value → false (strict allowlist)", () => {
    process.env[KEY] = "yes";
    expect(isComplianceEnabled()).toBe(false);
    process.env[KEY] = "TRUE";
    expect(isComplianceEnabled()).toBe(false);
  });

  test("read at call time — toggling env flips the result without a reimport", () => {
    delete process.env[KEY];
    expect(isComplianceEnabled()).toBe(false);
    process.env[KEY] = "true";
    expect(isComplianceEnabled()).toBe(true);
    process.env[KEY] = "0";
    expect(isComplianceEnabled()).toBe(false);
  });
});
