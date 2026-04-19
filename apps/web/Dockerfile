# Bematist web — Railway deployment Dockerfile (single-stage).
#
# Mirrors apps/ingest/Dockerfile — single-stage so Bun workspace symlinks
# stay intact. Builds Next.js then runs `next start`.
#
# Railway-specific:
#   - Private networking: DATABASE_URL, REDIS_URL point at .railway.internal
#     hostnames (resolved from env refs on the service).
#   - CLICKHOUSE_URL hits CH Cloud over public internet (creds in URL).
#   - Expose 3000 (HTTP dashboard + /api/auth/* Route Handlers).

FROM oven/bun:1.3-alpine

WORKDIR /app

# Copy the whole workspace — Railway's .railwayignore trims the noise.
COPY . .

# Install deps for all workspaces. Next.js picks up apps/web's deps via
# bun's workspace symlinks.
RUN bun install --frozen-lockfile

# Build Next.js. BUILD-time env vars that get inlined (NEXT_PUBLIC_*,
# TYPED_ROUTES output, etc.) are computed here; the runtime env is
# injected by Railway at start.
WORKDIR /app/apps/web
RUN bun run build

EXPOSE 3000

USER bun
CMD ["bun", "run", "start"]
