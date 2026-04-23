import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db, schema } from "./db";
import { eq } from "drizzle-orm";

// Fail fast if BETTER_AUTH_SECRET is missing or still the Dockerfile
// build-time placeholder. We allow the placeholder during `next build`
// (NEXT_PHASE=phase-production-build) so SSR prerendering can resolve
// this module without real secrets in the image, but refuse to boot the
// server with it. See .env.example for how to generate a real secret.
const BUILD_PLACEHOLDER = "build_placeholder_secret";
const isBuildPhase = process.env.NEXT_PHASE === "phase-production-build";
if (!isBuildPhase) {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret || secret === BUILD_PLACEHOLDER) {
    throw new Error(
      "BETTER_AUTH_SECRET is not set (or is still the build placeholder) — refusing to start. See .env.example."
    );
  }
}

export const auth = betterAuth({
  secret: process.env.BETTER_AUTH_SECRET!,
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
    },
  }),
  socialProviders: {
    github: {
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
      scope: ["read:org", "repo", "read:user", "user:email"],
      // Stash GitHub login + id on our user row
      mapProfileToUser: (profile: any) => ({
        githubLogin: profile.login,
        githubId: String(profile.id),
      }),
    },
  },
  user: {
    additionalFields: {
      githubLogin: { type: "string", required: false },
      githubId: { type: "string", required: false },
    },
  },
});

export type Auth = typeof auth;
