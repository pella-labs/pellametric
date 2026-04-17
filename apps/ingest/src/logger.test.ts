import { describe, expect, test } from "bun:test";
import { FORBIDDEN_FIELDS } from "@bematist/schema";
import { makeLogger, redactPaths } from "./logger";

function captureLogLine(fn: (log: ReturnType<typeof makeLogger>) => void): string {
  let captured = "";
  const stream = {
    write(chunk: string): void {
      captured += chunk;
    },
  };
  // makeLogger picks up LOG_LEVEL; override to debug so we capture everything.
  const prev = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = "debug";
  try {
    const log = makeLogger(stream);
    fn(log);
  } finally {
    if (prev === undefined) delete process.env.LOG_LEVEL;
    else process.env.LOG_LEVEL = prev;
  }
  return captured;
}

describe("pino redact config", () => {
  test("redactPaths includes Authorization header and every forbidden field", () => {
    expect(redactPaths).toContain("req.headers.authorization");
    expect(redactPaths).toContain("headers.authorization");
    expect(redactPaths).toContain("authorization");
    for (const f of FORBIDDEN_FIELDS) {
      expect(redactPaths.some((p) => p.includes(f))).toBe(true);
    }
  });

  test("Authorization header value is redacted in emitted log line", () => {
    const line = captureLogLine((log) => {
      log.info({ req: { headers: { authorization: "Bearer dm_test_abc" } } }, "auth header scan");
    });
    expect(line).not.toContain("dm_test_abc");
    expect(line).toContain("[Redacted]");
  });

  test("body.prompt_text is redacted when logged under a body envelope", () => {
    const line = captureLogLine((log) => {
      log.info({ body: { prompt_text: "supersecret42" } }, "body scan");
    });
    expect(line).not.toContain("supersecret42");
    expect(line).toContain("[Redacted]");
  });

  test("every forbidden field under body.* is redacted", () => {
    for (const field of FORBIDDEN_FIELDS) {
      const sentinel = `SENTINEL_${field}_VALUE`;
      const line = captureLogLine((log) => {
        log.info({ body: { [field]: sentinel } }, "fuzz log");
      });
      expect(line).not.toContain(sentinel);
    }
  });

  test("top-level prompt_text is redacted (no envelope)", () => {
    const line = captureLogLine((log) => {
      log.info({ prompt_text: "topsecret99" }, "toplevel");
    });
    expect(line).not.toContain("topsecret99");
    expect(line).toContain("[Redacted]");
  });

  test("M8: prompt_text at depth 5 is still redacted", () => {
    // Previously only depth 1-2 was covered by `*.` / `*.*.` paths. Our fix
    // generates rungs up to MAX_REDACT_DEPTH=5. A sentinel buried 5 keys
    // deep must still come back censored.
    const sentinel = "LEAK_AT_DEPTH_5";
    const line = captureLogLine((log) => {
      log.info({ a: { b: { c: { d: { e: { prompt_text: sentinel } } } } } }, "deep redact scan");
    });
    expect(line).not.toContain(sentinel);
  });
});
