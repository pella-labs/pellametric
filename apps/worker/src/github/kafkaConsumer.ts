// Real Kafka (kafkajs) consumer for the `github.webhooks` topic.
// Pairs with `apps/ingest/src/github-app/kafkaWebhookBus.ts`.
//
// Contract:
//   - topic: github.webhooks
//   - group: BEMATIST_WORKER_GROUP_ID env, default "bematist-github-worker"
//   - eachBatchAutoResolve=false so offsets commit only AFTER successful
//     Postgres UPSERT (the domain-write contract is exactly-once from the
//     consumer side; Redis SETNX dedupes replays if a batch is retried).
//   - consume handler delegates to `consumeMessage` in ./consumer.ts — the
//     same decoder/writer as the in-memory path.

import { type Consumer, type ConsumerConfig, Kafka, logLevel } from "kafkajs";
import type { ConsumerDeps } from "./consumer";
import { consumeMessage } from "./consumer";

export interface KafkaConsumerConfig {
  brokers: string[];
  topic: string;
  clientId?: string;
  groupId?: string;
  sessionTimeoutMs?: number;
  heartbeatIntervalMs?: number;
  /** Test-only hook: invoked after each successful message ack. */
  onCommit?: (offset: string) => void;
  /** Default false — prod consumer starts at end-of-log. Tests pass true. */
  fromBeginning?: boolean;
}

export interface KafkaConsumerHandle {
  /** Disconnect + stop. Idempotent. */
  stop(): Promise<void>;
  /** Observe the consumer directly (tests). */
  readonly consumer: Consumer;
}

/**
 * Subscribe + run. The caller awaits the returned handle only to stop on
 * SIGTERM. kafkajs handles reconnection + partition rebalance internally.
 */
export async function startKafkaGithubConsumer(
  config: KafkaConsumerConfig,
  deps: ConsumerDeps,
): Promise<KafkaConsumerHandle> {
  const log = deps.log ?? ((e) => console.log(JSON.stringify(e)));
  const kafka = new Kafka({
    clientId: config.clientId ?? "bematist-worker",
    brokers: config.brokers,
    logLevel: logLevel.WARN,
  });
  const consumerCfg: ConsumerConfig = {
    groupId: config.groupId ?? "bematist-github-worker",
    sessionTimeout: config.sessionTimeoutMs ?? 30_000,
    heartbeatInterval: config.heartbeatIntervalMs ?? 3_000,
    retry: { retries: 8, maxRetryTime: 30_000 },
  };
  const consumer = kafka.consumer(consumerCfg);

  await consumer.connect();
  await consumer.subscribe({ topic: config.topic, fromBeginning: config.fromBeginning ?? false });

  await consumer.run({
    autoCommit: false, // manual commit after UPSERT
    eachBatchAutoResolve: false,
    eachBatch: async ({
      batch,
      resolveOffset,
      heartbeat,
      commitOffsetsIfNecessary,
      isRunning,
      isStale,
    }) => {
      for (const message of batch.messages) {
        if (!isRunning() || isStale()) return;
        const value = message.value;
        if (!value) {
          // Tombstone — just advance the offset.
          resolveOffset(message.offset);
          continue;
        }
        try {
          const bytes = new Uint8Array(value);
          await consumeMessage(bytes, deps);
          resolveOffset(message.offset);
          config.onCommit?.(message.offset);
          log({
            app: "worker-github-kafka",
            kind: "ack",
            topic: batch.topic,
            partition: batch.partition,
            offset: message.offset,
          });
        } catch (err) {
          log({
            app: "worker-github-kafka",
            kind: "process-failed",
            err: err instanceof Error ? err.message : String(err),
            offset: message.offset,
          });
          // Re-throw so kafkajs retries the message with backoff. After
          // `retries` exhausted the consumer pauses the partition; an
          // operator can restart after fixing the underlying cause.
          throw err;
        }
        await heartbeat();
      }
      await commitOffsetsIfNecessary();
    },
  });

  return {
    consumer,
    async stop() {
      try {
        await consumer.disconnect();
      } catch {
        // ignore
      }
    },
  };
}
