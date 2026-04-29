import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db, schema } from "./db";
import { eq } from "drizzle-orm";

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
      scope: ["write:org", "repo", "read:user", "user:email"],
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
