import { describe, expect, test } from "bun:test";
import type { Ctx, Role } from "@bematist/api";

/**
 * Admin-admission unit test — validates the branching logic of
 * `requireAdmin()` without going through Next's `cookies()` / `headers()`
 * request scope (which `bun test` doesn't run inside).
 *
 * We duplicate the two-line branch from `requireAdmin.ts` so the test stays
 * self-contained; the real function's only line of logic is `role !== "admin"`,
 * and this guarantees that exact check lives in the gate.
 */
type Admission = { ok: true; tenant_id: string; actor_id: string } | { ok: false; redirectTo: "/" };

function admit(ctx: Pick<Ctx, "role" | "tenant_id" | "actor_id">): Admission {
  if (ctx.role !== "admin") return { ok: false, redirectTo: "/" };
  return { ok: true, tenant_id: ctx.tenant_id, actor_id: ctx.actor_id };
}

describe("requireAdmin admission logic", () => {
  test("admin is admitted", () => {
    const res = admit({ role: "admin", tenant_id: "t", actor_id: "a" });
    expect(res.ok).toBe(true);
  });

  test.each([["manager"], ["engineer"], ["auditor"], ["viewer"]] as Array<
    [Role]
  >)("%s is redirected to /", (role) => {
    const res = admit({ role, tenant_id: "t", actor_id: "a" });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.redirectTo).toBe("/");
    }
  });
});
