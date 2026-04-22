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
ENV DATABASE_URL=postgresql://user:pass@localhost:5432/db \
    BETTER_AUTH_SECRET=build_placeholder_secret \
    BETTER_AUTH_URL=http://localhost:3000 \
    GITHUB_CLIENT_ID=build_client_id \
    GITHUB_CLIENT_SECRET=build_client_secret \
    NEXT_PUBLIC_BETTER_AUTH_URL=http://localhost:3000
RUN bun run build

FROM oven/bun:1.3-slim AS runtime
ENV NODE_ENV=production
COPY --from=build /app /app
WORKDIR /app/apps/web
EXPOSE 3000
CMD ["bun", "run", "start"]
