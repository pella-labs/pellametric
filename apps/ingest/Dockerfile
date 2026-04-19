# Bematist ingest — Railway deployment Dockerfile (single-stage).
#
# Multi-stage was tried first but Bun workspace symlinks don't reliably
# survive `COPY --from=deps /app/node_modules` — runtime complained about
# missing `@bematist/config`. Single-stage is slower for rebuilds but
# correct; revisit when we're ready to ship a `bun build --compile`
# self-contained binary for the ingest service.
#
# Railway-specific:
#   - Private networking: DATABASE_URL, REDIS_URL injected via Railway refs
#     point at `.railway.internal` hostnames.
#   - CLICKHOUSE_URL points at CH Cloud over public internet (creds in URL).
#   - Expose 8000 (custom JSON) + 4318 (OTLP HTTP).

FROM oven/bun:1.3-alpine

WORKDIR /app

# Copy the whole workspace — Railway's .railwayignore trims the noise.
# This is not cache-optimal (any source change busts the install layer) but
# is the simplest correct posture.
COPY . .

RUN bun install --frozen-lockfile

# Default ports; Railway overrides via env where needed.
ENV INGEST_LISTEN_ADDR=":8000"
ENV OTLP_LISTEN_ADDR=":4318"

EXPOSE 8000 4318

WORKDIR /app/apps/ingest

# `ulimit -c 0` at shell start disables crash dumps (CLAUDE.md §Security Rules
# — belt) — runtime code also calls applyCoreRlimit() (suspenders).
USER bun
CMD ["/bin/sh", "-c", "ulimit -c 0 && exec bun src/index.ts"]
