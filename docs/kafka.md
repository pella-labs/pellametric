# Kafka / Redpanda transport

The webhook pipeline (`apps/ingest → apps/worker`) uses Kafka (Redpanda in
dev) as the ordered, partitioned queue between `POST /v1/webhooks/github/*`
and the worker's domain UPSERTs. See PRD §7.1 + Architecture Rule #7.

## Client: `kafkajs` (pure JS, v2.x)

We pin `kafkajs` — not `@confluentinc/kafka-javascript` — because:

- **Zero native deps.** `librdkafka` bindings would force us to bust the
  `oven/bun:1.2-alpine` container base, lose `bun build --compile` single-
  binary posture, and break one platform per release. kafkajs is pure JS;
  Bun runs it as-is.
- **Matches hand-rolled tech-stack posture.** The ingest already hand-rolls
  GitHub App JWT, HMAC verification, and Redis Lua — kafkajs fits that
  discipline. `@octokit/auth-app` was rejected for the same reason.
- **Plan B exists.** If kafkajs throughput fails the 24h soak gate (F15 /
  INT0), we fall through to the ingest-sidecar pattern Architecture Rule #7
  already documents: write messages to a UNIX socket from Bun, let a
  Go process speak Kafka. No architectural surprise, no re-platforming.

The library was chosen by orchestrator decision on 2026-04-18 along with
G2 Phase wiring.

## Transport toggle

`KAFKA_TRANSPORT` env var switches between two implementations of the same
`WebhookBusProducer` interface:

| Value | Implementation | When to use |
| --- | --- | --- |
| `kafkajs` *(default)* | `KafkaWebhookBus` in `apps/ingest/src/github-app/kafkaWebhookBus.ts` | Production, dev with Redpanda up, integration tests with `E2E_KAFKA=1` |
| `memory` | `InMemoryWebhookBus` in `apps/ingest/src/github-app/webhookBus.ts` | Unit tests, solo/embedded mode with no broker, quick local dev without docker-compose |

The switch happens at boot in `apps/ingest/src/index.ts` — the webhook route
code is identical between modes. Both producers satisfy the same narrow
interface (`publish(topic, msg)` + `close()`), so the webhook route never
branches.

Worker consumer side mirrors the toggle: `KAFKA_TRANSPORT=memory` skips the
consumer loop entirely (nothing to consume); `KAFKA_TRANSPORT=kafkajs`
starts `startKafkaGithubConsumer` in `apps/worker/src/github/kafkaConsumer.ts`.

## Topic

- **Name:** `github.webhooks`
- **Partitions:** 32 (locked — PRD §7.1)
- **Key:** `${tenant_id}:${installation_id}` → per-tenant ordering within a
  partition.
- **Value:** `WebhookBusPayload` JSON encoded as bytes (schema in
  `apps/ingest/src/github-app/webhookBus.ts`).

Auto-creation: the ingest's `createKafkaWebhookBus()` calls `ensureTopic()`
at boot — explicit `numPartitions=32, replicationFactor=1` for dev; ops
override these for prod via infra.

## Consumer posture

- **Group ID:** `bematist-github-worker` (env: `BEMATIST_WORKER_GROUP_ID`).
- **`autoCommit=false`** — we commit offsets ONLY after a successful
  Postgres UPSERT returns. Replays are safe because every domain UPSERT
  is keyed on a PRIMARY KEY with `ON CONFLICT DO UPDATE`, and the webhook
  `X-GitHub-Delivery` Redis SETNX (7-day TTL) short-circuits duplicates at
  the ingest side.
- **`eachBatchAutoResolve=false`** — for the same reason as above.
  Per-message `resolveOffset` advances the cursor only on success.
- **Retry budget:** 8 retries with 30s max backoff. After that the
  partition pauses until operator intervention — we'd rather bounce a
  single partition than poison the whole group with a runaway retry loop.

## Running locally

```bash
# Bring up Redpanda (the dev compose file has postgres + redis + clickhouse + redpanda).
docker compose -f docker-compose.dev.yml up -d redpanda

# Ingest + worker pick up the default transport (kafkajs).
bun run dev                     # starts both apps with KAFKA_TRANSPORT default

# Force memory-only mode (solo/embedded; ignores broker).
KAFKA_TRANSPORT=memory bun run dev
```

## Running the E2E test

```bash
docker compose -f docker-compose.dev.yml up -d redpanda
E2E_KAFKA=1 bun test apps/worker/src/github/kafkaE2E.test.ts
```

The test publishes one real `pull_request` fixture, runs the consumer in
the same process, and asserts the worker's Postgres UPSERT SQL fires
(`INSERT INTO github_pull_requests ...`) + a recompute message is
emitted. Topic name is randomized per run so reruns don't interfere.

## Plan B escape hatch

If kafkajs soak testing reveals throughput or reliability issues before
M2, we fall through to the Architecture Rule #7 pattern: stand up a tiny
`apps/ingest-sidecar/` Go binary that reads messages from a UNIX socket
fed by Bun and speaks Kafka via `clickhouse-go/v2`-style idiomatic
bindings. The sidecar contract is already on the architecture roadmap
and is Plan B for both the CH writer and the Kafka producer (single
sidecar process serves both). No code ships for it yet — the Bun +
kafkajs path is believed sufficient through soak.

## Environment variables

| Var | Default | Meaning |
| --- | --- | --- |
| `KAFKA_TRANSPORT` | `kafkajs` | Switch producer/consumer between real broker and in-memory (`memory`). |
| `KAFKA_BROKERS` or `REDPANDA_BROKERS` | `localhost:9092` | Comma-separated broker list. |
| `KAFKA_CLIENT_ID` | `bematist-ingest` | Used by kafkajs producer. |
| `BEMATIST_WORKER_GROUP_ID` | `bematist-github-worker` | Consumer group id. |
| `GITHUB_WEBHOOKS_TOPIC` | `github.webhooks` | Override for test environments. |
