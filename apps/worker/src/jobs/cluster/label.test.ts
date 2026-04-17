import { expect, test } from "bun:test";
import { generateLabel, type HaikuCompleter } from "./label";
import { validateLabel } from "./label_validate";

test("validateLabel: accepts 3-5 word lowercase label", () => {
  expect(validateLabel("refactor api routes").ok).toBe(true);
  expect(validateLabel("debug failing unit tests").ok).toBe(true);
  expect(validateLabel("add typescript generic return types").ok).toBe(true);
});

test("validateLabel: rejects too short / too long", () => {
  expect(validateLabel("refactor").reason).toBe("too_short");
  expect(validateLabel("two words").reason).toBe("too_short");
  expect(validateLabel("this is way too many words for a label to be").reason).toBe("too_long");
});

test("validateLabel: rejects URL", () => {
  expect(validateLabel("see https://docs.example.com docs").reason).toBe("contains_url");
});

test("validateLabel: rejects email", () => {
  expect(validateLabel("contact dev@example.com directly").reason).toBe("contains_email");
});

test("validateLabel: rejects digits", () => {
  expect(validateLabel("refactor 3 api routes").reason).toBe("contains_digits");
});

test("validateLabel: rejects proper noun (engineer name)", () => {
  expect(validateLabel("talked with Sarah about auth").reason).toBe("contains_proper_noun");
  expect(validateLabel("reviewed with Alice refactor").reason).toBe("contains_proper_noun");
});

test("validateLabel: allows short capitalized acronyms (API, SQL)", () => {
  // Length check is >= 5 chars, so 3-letter acronyms don't trigger.
  expect(validateLabel("refactor API routes").ok).toBe(true);
});

test("validateLabel: allows common tech terms", () => {
  expect(validateLabel("build docker image layer").ok).toBe(true);
  expect(validateLabel("commit to aws lambda").ok).toBe(true);
});

/** Canned completer returning a queue of JSON strings. */
function stubCompleter(responses: string[]): HaikuCompleter {
  let i = 0;
  return {
    async complete() {
      const r = responses[i];
      if (r === undefined) throw new Error("stubCompleter: exhausted");
      i++;
      return r;
    },
  };
}

test("generateLabel: valid label accepted on first try", async () => {
  const completer = stubCompleter([JSON.stringify({ label: "refactor api routes" })]);
  const res = await generateLabel(["abstract 1", "abstract 2"], completer, "c_test");
  expect(res.label).toBe("refactor api routes");
  expect(res.attempts).toHaveLength(1);
});

test("generateLabel: URL response rejected, retry succeeds", async () => {
  const completer = stubCompleter([
    JSON.stringify({ label: "see https://example.com docs" }),
    JSON.stringify({ label: "debug failing tests" }),
  ]);
  const res = await generateLabel(["a"], completer, "c_test");
  expect(res.label).toBe("debug failing tests");
  expect(res.attempts).toHaveLength(2);
  expect(res.attempts[0]?.rejected_reason).toBe("contains_url");
});

test("generateLabel: proper noun rejected twice → label=null", async () => {
  const completer = stubCompleter([
    JSON.stringify({ label: "chatted with Sarah auth" }),
    JSON.stringify({ label: "reviewed with Alice refactor" }),
  ]);
  const res = await generateLabel(["a"], completer, "c_test");
  expect(res.label).toBeNull();
  expect(res.attempts).toHaveLength(2);
  expect(res.attempts[0]?.rejected_reason).toBe("contains_proper_noun");
  expect(res.attempts[1]?.rejected_reason).toBe("contains_proper_noun");
});

test("generateLabel: non-JSON response handled", async () => {
  const completer = stubCompleter([
    "not json at all",
    JSON.stringify({ label: "refactor api routes" }),
  ]);
  const res = await generateLabel(["a"], completer, "c_test");
  expect(res.label).toBe("refactor api routes");
});
