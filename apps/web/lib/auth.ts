import "server-only";
import { pg as schema } from "@bematist/schema";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { type BridgeDeps, bridgeBetterAuthUser } from "./auth-bridge";

/**
 * Better Auth server config for the dashboard (M4 PR 1).
 *
 * Scope: GitHub OAuth only. No email / password, no magic link — the M4
 * brief calls out that "GitHub OAuth is enough for now" and we want to
 * avoid email-delivery infra until the cloud-managed mode is actually
 * on the roadmap (Phase 4 per CLAUDE.md).
 *
 * Schema decision (option (a) from the M4 plan): Better Auth owns its
 * own tables (`better_auth_*`); our existing `users` table keeps its
 * tenant-scoped shape and gains a nullable `better_auth_user_id` FK.
 * See `packages/schema/postgres/migrations/0004_better_auth_tables.sql`
 * for the header explaining why.
 *
 * Bridge hook: on first OAuth sign-in, we back-fill a `users` row for
 * the Better Auth identity. The first user in a given org is promoted
 * to `role='admin'`; subsequent users land as `role='ic'`. See
 * `./auth-bridge.ts` for the pure logic (unit-tested without a DB).
 */

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5433/bematist";
const BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET ?? "dev-only-change-in-prod";
const BETTER_AUTH_URL = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";

const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID ?? "";
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET ?? "";

// Lazy singleton guarded on globalThis so Next.js Fast Refresh / HMR
// doesn't thrash the Postgres pool in `next dev`.
type AuthGlobals = typeof globalThis & {
  __bematist_auth?: ReturnType<typeof makeAuth>;
  __bematist_auth_pg?: ReturnType<typeof postgres>;
};

function makeAuth() {
  const pg = postgres(DATABASE_URL, { max: 5 });
  const db = drizzle(pg, { schema });

  // Better Auth's drizzle adapter looks up tables by `schema[modelName]`.
  // Our Drizzle schema exports the Better Auth tables under
  // `betterAuthUser`/`betterAuthSession`/etc. to avoid colliding with our
  // internal `users` table; the `modelName` overrides below point Better
  // Auth at the right schema keys. The full schema is passed through so
  // the adapter's `fullSchema` fallback lookup (by Drizzle table identity)
  // also succeeds.
  const adapterSchema = {
    user: schema.betterAuthUser,
    session: schema.betterAuthSession,
    account: schema.betterAuthAccount,
    verification: schema.betterAuthVerification,
  };

  // Bridge deps — thin wrapper so the `auth-bridge` module stays DB-agnostic
  // and we can unit-test it with fake functions.
  const bridge: BridgeDeps = {
    countUsersInOrg: async (orgId: string) => {
      const rows = (await pg`
        SELECT count(*)::int AS n FROM users WHERE org_id = ${orgId}
      `) as unknown as Array<{ n: number }>;
      return rows[0]?.n ?? 0;
    },
    findUserByBetterAuthId: async (betterAuthUserId: string) => {
      const rows = (await pg`
        SELECT id, org_id, role
        FROM users
        WHERE better_auth_user_id = ${betterAuthUserId}
        LIMIT 1
      `) as unknown as Array<{ id: string; org_id: string; role: string }>;
      const row = rows[0];
      return row ? { id: row.id, orgId: row.org_id, role: row.role } : null;
    },
    findUserByEmail: async (email: string) => {
      const rows = (await pg`
        SELECT id, org_id, role, better_auth_user_id
        FROM users
        WHERE email = ${email}
        LIMIT 1
      `) as unknown as Array<{
        id: string;
        org_id: string;
        role: string;
        better_auth_user_id: string | null;
      }>;
      const row = rows[0];
      return row
        ? {
            id: row.id,
            orgId: row.org_id,
            role: row.role,
            betterAuthUserId: row.better_auth_user_id,
          }
        : null;
    },
    getOrCreateDefaultOrg: async () => {
      // The "default org" = first row by created_at. Seeded in dev by
      // `bun run db:seed`; in prod it's whatever the operator created before
      // inviting the team. If none exists, create one so a fresh self-host
      // install doesn't fall over on the first sign-up.
      const rows = (await pg`
        SELECT id FROM orgs ORDER BY created_at ASC LIMIT 1
      `) as unknown as Array<{ id: string }>;
      if (rows[0]) return rows[0].id;
      const created = (await pg`
        INSERT INTO orgs (slug, name)
        VALUES ('default', 'Default')
        RETURNING id
      `) as unknown as Array<{ id: string }>;
      return created[0]?.id ?? "";
    },
    linkBetterAuthIdToUser: async (userId: string, betterAuthUserId: string) => {
      await pg`
        UPDATE users
        SET better_auth_user_id = ${betterAuthUserId}
        WHERE id = ${userId}
      `;
    },
    createUser: async (params) => {
      const rows = (await pg`
        INSERT INTO users (org_id, sso_subject, email, role, better_auth_user_id)
        VALUES (${params.orgId}, ${params.ssoSubject}, ${params.email}, ${params.role}, ${params.betterAuthUserId})
        RETURNING id
      `) as unknown as Array<{ id: string }>;
      return rows[0]?.id ?? "";
    },
  };

  return betterAuth({
    secret: BETTER_AUTH_SECRET,
    baseURL: BETTER_AUTH_URL,
    // basePath defaults to `/api/auth` — matches the catch-all handler at
    // `apps/web/app/api/auth/[...all]/route.ts`.
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: adapterSchema,
    }),
    socialProviders: {
      // GitHub OAuth is the ONLY flow (M4 PR 1). If clientId/secret aren't
      // set the provider fails fast on sign-in; the `/auth/sign-in` page
      // surfaces this as a friendly "OAuth not configured" message in dev.
      github: {
        clientId: GITHUB_CLIENT_ID,
        clientSecret: GITHUB_CLIENT_SECRET,
      },
    },
    emailAndPassword: {
      enabled: false,
    },
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            // Bridge Better Auth identity → internal `users` row. Pure logic
            // lives in `./auth-bridge.ts` (unit-tested); here we just wire
            // the DB callbacks.
            await bridgeBetterAuthUser(bridge, {
              betterAuthUserId: user.id,
              email: user.email,
            });
          },
        },
      },
    },
    plugins: [
      // next-js cookies plugin — lets Better Auth set-cookie from Server
      // Actions, not just Route Handlers. Required for any future
      // sign-out-via-Server-Action wiring.
      nextCookies(),
    ],
  });
}

export function getAuth() {
  const g = globalThis as AuthGlobals;
  if (!g.__bematist_auth) {
    g.__bematist_auth = makeAuth();
  }
  return g.__bematist_auth;
}

export type Auth = ReturnType<typeof getAuth>;
