import { expect, test } from "@playwright/test";

/**
 * `/api/export` privacy invariants (CLAUDE.md §API Rules):
 *   - Default export (no ?include_prompts) returns 200 + CSV. The CSV header
 *     MUST NOT include the `prompt_text`, `tool_input`, or `tool_output`
 *     columns — the server strips them regardless of the underlying row shape.
 *   - Export WITH `?include_prompts=true` and no 2FA header returns HTTP 403
 *     with a JSON body whose `code` is `"2fa_required"`. The UI uses that
 *     code to drive the WebAuthn/TOTP prompt flow.
 */

test.describe("/api/export prompt-column guardrails", () => {
  test("default export returns CSV with no prompt columns", async ({ request }) => {
    const res = await request.get("/api/export");
    expect(res.status()).toBe(200);

    const contentType = res.headers()["content-type"] ?? "";
    expect(contentType).toContain("text/csv");

    const body = await res.text();
    const header = body.split(/\r?\n/, 1)[0] ?? "";
    const columns = header.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));

    expect(columns).toContain("session_id");
    expect(columns).toContain("engineer_id");
    expect(columns).toContain("cost_usd");

    // Prompt columns MUST NOT leak when include_prompts is absent.
    expect(columns).not.toContain("prompt_text");
    expect(columns).not.toContain("tool_input");
    expect(columns).not.toContain("tool_output");

    // Defense-in-depth: no fixture prompt body text either. The fixture emits
    // `[fixture prompt N]` under `prompt_text`; with the strip in place, none
    // of those strings should survive into the serialized CSV.
    expect(body).not.toMatch(/\[fixture prompt \d+\]/);
  });

  test("include_prompts=true without 2FA header returns 403 + 2fa_required", async ({
    request,
  }) => {
    const res = await request.get("/api/export?include_prompts=true");
    expect(res.status()).toBe(403);

    const json = (await res.json()) as { error?: string; code?: string };
    // The route returns `{ error: "forbidden", code: "2fa_required", ... }`.
    // The prompt prescribed `{ error: "2fa_required" }` — the actual shape
    // puts it under `code`. Assert on `code` to match what the route emits.
    expect(json.code).toBe("2fa_required");
    expect(json.error).toBe("forbidden");
  });
});
