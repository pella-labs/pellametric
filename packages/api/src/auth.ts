/**
 * Server-side auth context shared by every query and mutation in this package.
 *
 * The dashboard (apps/web) constructs a `Ctx` from the Better Auth session
 * cookie inside `apps/web/lib/session.ts`. The CLI constructs one by validating
 * a bearer token. Test harnesses build them directly.
 *
 * RBAC is enforced HERE, inside each query/mutation — not at the Route Handler
 * or Server Action layer. That way defense-in-depth holds even if a wrapper
 * forgets.
 */

export type Role = "admin" | "manager" | "engineer" | "auditor" | "viewer";

export interface Ctx {
  /** Server-derived tenant (never trusted from client attrs). */
  tenant_id: string;
  /** Stable hash of the SSO subject for the authenticated principal. */
  actor_id: string;
  /** RBAC role for this request. */
  role: Role;
  /** Present only after a successful reveal gesture (contract 07 §Reveal). */
  reveal_token?: string;
  /** Primary clients — apps/web wires these, packages/api never constructs them. */
  db: {
    pg: PgClient;
    ch: ClickHouseClient;
    redis: RedisClient;
  };
}

/**
 * Minimal shape the queries need. The real clients live in `apps/web/lib/db.ts`.
 * We type against these interfaces so tests can pass in fakes without a real DB.
 */
export interface PgClient {
  query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
}

export interface ClickHouseClient {
  query<T = unknown>(sql: string, params?: Record<string, unknown>): Promise<T[]>;
}

export interface RedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;
  setNx(key: string, value: string, ttlSeconds?: number): Promise<boolean>;
}

export class AuthError extends Error {
  constructor(
    public code: "UNAUTHORIZED" | "FORBIDDEN" | "BAD_REQUEST",
    message: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

/**
 * Assert the actor's role is in `allowed`; otherwise throw `AuthError`.
 * Queries/mutations call this as their first line.
 */
export function assertRole(ctx: Ctx, allowed: readonly Role[]): void {
  if (!allowed.includes(ctx.role)) {
    throw new AuthError(
      "FORBIDDEN",
      `role '${ctx.role}' is not allowed for this operation (requires one of: ${allowed.join(", ")})`,
    );
  }
}
