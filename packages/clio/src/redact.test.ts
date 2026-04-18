import { describe, expect, test } from "bun:test";
import { builtinRedactStage, runRedact } from "./redact";
import { CLIO_PIPELINE_VERSION } from "./types";

describe("Stage 1 — redact", () => {
  test("masks AWS access key", async () => {
    const r = await runRedact({ rawPromptText: "key=AKIAIOSFODNN7EXAMPLE oops" });
    expect(r.text).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(r.text).toMatch(/<REDACTED:secret:/);
    expect(r.report.counts.secret).toBeGreaterThanOrEqual(1);
  });

  test("masks GitHub PAT", async () => {
    const tok = `ghp_${"A".repeat(36)}`;
    const r = await runRedact({ rawPromptText: `Bearer ${tok}` });
    expect(r.text).not.toContain(tok);
  });

  test("masks Slack webhook URL", async () => {
    // Construct via concat so GitHub's secret scanner doesn't false-positive
    // on the synthetic literal — the runtime regex still sees the joined string.
    const url = [
      "https://hooks.slack.com/services",
      "TEXAMPLE",
      "BEXAMPLE",
      "exampleexampleexampleabcd",
    ].join("/");
    const r = await runRedact({ rawPromptText: `webhook=${url}` });
    expect(r.text).not.toContain(url);
  });

  test("masks JWTs", async () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
    const r = await runRedact({ rawPromptText: `auth ${jwt}` });
    expect(r.text).not.toContain(jwt);
  });

  test("masks email addresses", async () => {
    const r = await runRedact({ rawPromptText: "ping alex@stripe.com asap" });
    expect(r.text).not.toContain("alex@stripe.com");
    expect(r.report.counts.email).toBeGreaterThanOrEqual(1);
  });

  test("masks phone numbers, SSN, IP", async () => {
    const r = await runRedact({
      rawPromptText: "call 415-555-0188 with SSN 123-45-6789 from 10.20.30.40",
    });
    expect(r.text).not.toContain("415-555-0188");
    expect(r.text).not.toContain("123-45-6789");
    expect(r.text).not.toContain("10.20.30.40");
  });

  test("masks home directory paths", async () => {
    const r = await runRedact({ rawPromptText: "open /Users/sgarces/secrets.json" });
    expect(r.text).not.toContain("/Users/sgarces");
  });

  test("clean prompt passes through unchanged", async () => {
    const txt = "How do I refactor a function to return an option type?";
    const r = await runRedact({ rawPromptText: txt });
    expect(r.text).toBe(txt);
    expect(r.report.counts.secret ?? 0).toBe(0);
    expect(r.report.counts.email ?? 0).toBe(0);
  });

  test("report carries pipeline_version", async () => {
    const r = await runRedact({ rawPromptText: "hi" });
    expect(r.report.pipeline_version).toBe(CLIO_PIPELINE_VERSION);
  });

  test("respects an injected RedactStage (DI seam for A6 engines)", async () => {
    let calls = 0;
    const r = await runRedact({
      rawPromptText: "anything",
      stage: {
        run(input) {
          calls++;
          return {
            ...(input.prompt_text !== undefined ? { prompt_text: "<INJECTED>" } : {}),
            redaction_count: 7,
            redaction_breakdown: { secret: 7 },
            markers: [],
            raw_attrs_filtered: false,
          };
        },
      },
    });
    expect(calls).toBe(1);
    expect(r.text).toBe("<INJECTED>");
    expect(r.report.counts.secret).toBe(7);
  });

  test("builtin stage returns the noop-shaped contract", async () => {
    const out = await builtinRedactStage.run({ tier: "B", prompt_text: "x@y.com" });
    expect(out.prompt_text).not.toContain("x@y.com");
    expect(out.redaction_count).toBeGreaterThanOrEqual(1);
    expect(out.markers.length).toBeGreaterThanOrEqual(1);
  });
});
