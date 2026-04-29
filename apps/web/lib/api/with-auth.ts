import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { apiError } from "./error";

type RouteCtx = { params: Promise<Record<string, string>> };

/**
 * Wraps a Next.js app-router route handler with Better-Auth session auth.
 * Returns 401 via `apiError` when no user is present; otherwise invokes
 * the handler with the resolved `userId` alongside the route's native
 * context. For dynamic routes, `params` is the same `Promise<...>` Next.js
 * passes; for static routes, it's a Promise resolving to `{}`.
 */
export function withAuth<R extends Response = Response>(
  handler: (req: Request, ctx: RouteCtx & { userId: string }) => Promise<R>,
) {
  return async (req: Request, ctx: RouteCtx): Promise<Response> => {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) return apiError("unauthorized", undefined, 401);
    return handler(req, { ...ctx, userId: session.user.id });
  };
}
