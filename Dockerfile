# Multi-stage Dockerfile for Railway.
# Builds the Next.js web app (which also consumes the collector's
# bun-bundled collector.mjs into apps/web/public/) and runs it with bun.

FROM oven/bun:1.3-slim AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/web/package.json apps/web/
COPY apps/collector/package.json apps/collector/
COPY packages/shared/package.json packages/shared/
RUN bun install --frozen-lockfile

FROM oven/bun:1.3-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=deps /app/apps/collector/node_modules ./apps/collector/node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY . .
# NEXT_PUBLIC_* vars are inlined into the client bundle at build time, so this
# must be the real public URL. Overridable via --build-arg for staging/previews.
ARG NEXT_PUBLIC_BETTER_AUTH_URL=https://pellametric.com
# Build-stage-only placeholders. Next.js prerendering imports modules that
# reference these, but nothing actually contacts the DB / GitHub / issues
# sessions during the build. They are intentionally NOT forwarded to the
# runtime stage — Railway / Docker host MUST inject real values at runtime.
# `apps/web/lib/auth.ts` has a fail-fast guard that refuses to boot the
# server when BETTER_AUTH_SECRET is missing or still the placeholder.
ARG BETTER_AUTH_SECRET=build_placeholder_secret
ARG DATABASE_URL=postgresql://user:pass@localhost:5432/db
ARG BETTER_AUTH_URL=http://localhost:3000
ARG GITHUB_CLIENT_ID=build_client_id
ARG GITHUB_CLIENT_SECRET=build_client_secret
ENV DATABASE_URL=$DATABASE_URL \
    BETTER_AUTH_SECRET=$BETTER_AUTH_SECRET \
    BETTER_AUTH_URL=$BETTER_AUTH_URL \
    GITHUB_CLIENT_ID=$GITHUB_CLIENT_ID \
    GITHUB_CLIENT_SECRET=$GITHUB_CLIENT_SECRET \
    NEXT_PUBLIC_BETTER_AUTH_URL=$NEXT_PUBLIC_BETTER_AUTH_URL
RUN bun run build

FROM oven/bun:1.3-slim AS runtime
ENV NODE_ENV=production
COPY --from=build /app /app
WORKDIR /app/apps/web
EXPOSE 3000
CMD ["bun", "run", "start"]
