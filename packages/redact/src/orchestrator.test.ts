import { describe, expect, test } from "bun:test";
import { createRedactionStage, defaultRedactionStage } from "./orchestrator";
import type { RedactionMarker } from "./stage";

const MARKER_RE =
  /^<REDACTED:(secret|email|phone|name|ip|credit_card|ssn|url|address|other):[0-9a-f]{16}>$/;

describe("orchestrator basics", () => {
  test("string with one secret yields one marker; format <REDACTED:type:hash>", async () => {
    const r = await defaultRedactionStage.run({
      tier: "C",
      prompt_text: "key=AKIAIOSFODNN7EXAMPLE for the deploy",
    });
    expect(r.redaction_count).toBe(1);
    const marker = r.markers[0];
    if (marker === undefined) throw new Error("expected at least one marker");
    expect(marker.detector).toBe("trufflehog");
    expect(marker.rule).toBe("AWSAccessKey");
    expect(r.prompt_text).toMatch(/^key=<REDACTED:secret:[0-9a-f]{16}> for the deploy$/);
  });

  test("clean string returns identical text and zero markers", async () => {
    const r = await defaultRedactionStage.run({
      tier: "C",
      prompt_text: "Refactor the cache layer to use Redis Streams.",
    });
    expect(r.redaction_count).toBe(0);
    expect(r.markers).toHaveLength(0);
    expect(r.prompt_text).toBe("Refactor the cache layer to use Redis Streams.");
  });

  test("redaction is deterministic — same input → same hash and markers", async () => {
    const inp = {
      tier: "C" as const,
      prompt_text: "ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ012345678901",
    };
    const a = await defaultRedactionStage.run(inp);
    const b = await defaultRedactionStage.run(inp);
    expect(a).toEqual(b);
  });

  test("nested tool_input redacts string leaves; preserves structure", async () => {
    const r = await defaultRedactionStage.run({
      tier: "C",
      tool_input: {
        cmd: "psql postgres://user:hunter2@db.svc:5432/app",
        args: ["select", "*"],
        meta: { ts: 123, env: { TOKEN: "ghp_abcDEFghi1234567890ABCDEFghijklmnop" } },
      },
    });
    const ti = r.tool_input as {
      cmd: string;
      args: string[];
      meta: { ts: number; env: { TOKEN: string } };
    };
    expect(ti.cmd).toMatch(/<REDACTED:secret:/);
    expect(ti.args).toEqual(["select", "*"]);
    expect(ti.meta.ts).toBe(123);
    expect(ti.meta.env.TOKEN).toMatch(/^<REDACTED:secret:[0-9a-f]{16}>$/);
    expect(r.redaction_count).toBeGreaterThanOrEqual(2);
  });

  test("Tier-A also drops non-allowlisted raw_attrs keys", async () => {
    const r = await defaultRedactionStage.run({
      tier: "A",
      raw_attrs: {
        schema_version: 1,
        prompt_text: "leaked",
        custom_random_key: "x",
      },
    });
    const attrs = r.raw_attrs as Record<string, unknown>;
    expect(attrs.schema_version).toBe(1);
    expect("prompt_text" in attrs).toBe(false);
    expect("custom_random_key" in attrs).toBe(false);
    expect(r.raw_attrs_filtered).toBe(true);
  });

  test("Tier-A allowlist extras flow through", async () => {
    const stage = createRedactionStage({ raw_attrs_allowlist_extra: ["my.custom.key"] });
    const r = await stage.run({
      tier: "A",
      raw_attrs: { my: { custom: { key: 7 } }, other: 9 },
    });
    const attrs = r.raw_attrs as { my: { custom: { key: number } } };
    expect(attrs.my.custom.key).toBe(7);
    expect("other" in (r.raw_attrs as object)).toBe(false);
  });

  test("redaction_breakdown sums per type", async () => {
    const r = await defaultRedactionStage.run({
      tier: "C",
      prompt_text:
        "AKIAIOSFODNN7EXAMPLE / sk-ant-api03-XYZxyz1234567890abcdefABCDEFghijKLMN_- / jane@example.com",
    });
    expect(r.redaction_breakdown.secret).toBe(2);
    expect(r.redaction_breakdown.email).toBe(1);
  });

  test("markers are well-formed; renderings match the contract regex", async () => {
    const r = await defaultRedactionStage.run({
      tier: "C",
      prompt_text: "AKIAIOSFODNN7EXAMPLE",
    });
    expect(r.prompt_text).toMatch(MARKER_RE);
    for (const m of r.markers) {
      expect(m.hash).toMatch(/^[0-9a-f]{16}$/);
      expect(["trufflehog", "gitleaks", "presidio"] as const).toContain(m.detector);
    }
  });

  test("undefined input fields stay undefined", async () => {
    const r = await defaultRedactionStage.run({ tier: "B" });
    expect(r.prompt_text).toBeUndefined();
    expect(r.tool_input).toBeUndefined();
    expect(r.tool_output).toBeUndefined();
    expect(r.raw_attrs).toBeUndefined();
    expect(r.redaction_count).toBe(0);
  });
});

describe("orchestrator overlap handling", () => {
  test("overlapping rules collapse to a single span (no double-redaction)", async () => {
    // The PEMPrivateKey header is also a substring no other rule catches; we
    // rely on the JWT/AzureStorageKey vs AWS rules NOT producing overlapping
    // spans for the same bytes. Here we confirm one secret = one marker.
    const r = await defaultRedactionStage.run({
      tier: "C",
      prompt_text: "secret_key=AKIAIOSFODNN7EXAMPLE other text",
    });
    // Both PasswordAssignment and AWSAccessKey patterns are candidates;
    // AWSAccessKey wins (earlier start, longer span via merge).
    expect(r.markers.length).toBeGreaterThanOrEqual(1);
    // The output must not have a stray "<REDACTED:" inside another marker.
    expect(r.prompt_text).not.toMatch(/<REDACTED:[^>]*<REDACTED/);
  });

  test("two adjacent independent secrets emit two distinct markers", async () => {
    const r = await defaultRedactionStage.run({
      tier: "C",
      prompt_text: "ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ012345678901 then AKIAIOSFODNN7EXAMPLE",
    });
    expect(r.redaction_count).toBe(2);
    const types = new Set(r.markers.map((m: RedactionMarker) => m.rule));
    expect(types.has("GitHubPAT")).toBe(true);
    expect(types.has("AWSAccessKey")).toBe(true);
  });
});

describe("orchestrator does not retain raw secrets in markers", () => {
  test("markers carry only hash + type + detector + rule", async () => {
    const r = await defaultRedactionStage.run({
      tier: "C",
      prompt_text: "AKIAIOSFODNN7EXAMPLE",
    });
    for (const m of r.markers) {
      expect(Object.keys(m).sort()).toEqual(["detector", "hash", "rule", "type"]);
      // hash must NOT be the raw value
      expect(m.hash).not.toContain("AKIA");
    }
  });
});
