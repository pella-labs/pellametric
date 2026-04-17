import "server-only";
import { AuthError, type Ctx } from "@bematist/api";
import type { ZodTypeAny, z } from "zod";
import { getSessionCtx } from "./session";

/**
 * Discriminated-result type returned by every Server Action in this app.
 * Client components switch on `ok` to render success or error UI without
 * throwing across the `"use server"` boundary.
 */
export type ActionResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      error: {
        code:
          | "UNAUTHORIZED"
          | "FORBIDDEN"
          | "BAD_REQUEST"
          | "NOT_FOUND"
          | "TOO_MANY_REQUESTS"
          | "INTERNAL_SERVER_ERROR";
        message: string;
        issues?: z.ZodIssue[];
      };
    };

/**
 * Wrap a server-side mutation so it:
 *   1. resolves the request Ctx from the session,
 *   2. parses the input with the provided zod schema,
 *   3. invokes the mutation,
 *   4. returns a discriminated `ActionResult`.
 *
 * Usage:
 *   export const revealSessionAction = zodAction(RevealInput, revealSession);
 *
 * Callers hand the returned function directly to `useFormState` /
 * `useTransition` in a Client Component, or call it from an RSC.
 */
export function zodAction<Schema extends ZodTypeAny, Out>(
  input: Schema,
  handler: (ctx: Ctx, parsed: z.infer<Schema>) => Promise<Out>,
) {
  return async function action(raw: z.input<Schema>): Promise<ActionResult<Out>> {
    const parsed = input.safeParse(raw);
    if (!parsed.success) {
      return {
        ok: false,
        error: {
          code: "BAD_REQUEST",
          message: "Invalid input.",
          issues: parsed.error.issues,
        },
      };
    }
    try {
      const ctx = await getSessionCtx();
      const data = await handler(ctx, parsed.data);
      return { ok: true, data };
    } catch (err) {
      if (err instanceof AuthError) {
        return { ok: false, error: { code: err.code, message: err.message } };
      }
      const message = err instanceof Error ? err.message : "Unexpected server error.";
      return {
        ok: false,
        error: { code: "INTERNAL_SERVER_ERROR", message },
      };
    }
  };
}
