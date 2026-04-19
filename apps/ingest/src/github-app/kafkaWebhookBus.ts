// Real Kafka (kafkajs) producer for the GitHub webhook ingest pipeline.
//
// PRD §7.1 / Architecture Rule #7 compliant: kafkajs is pure-JS, zero
// native deps, works under `bun build --compile` and on the oven/bun alpine
// base image. Plan B (Go ingest-sidecar over UNIX socket) is the
// throughput-under-soak escape hatch; see docs/kafka.md.
//
// Wire contract (matches the in-memory double in ./webhookBus):
//   - topic: GITHUB_WEBHOOKS_TOPIC ("github.webhooks")
//   - key:   `${tenant_id}:${installation_id}` — preserves per-tenant
//            partition affinity
//   - value: encoded WebhookBusPayload (JSON bytes)
//   - acks:  all  (Kafka-level idempotency on)
//   - timeout: 5s — stays well inside GitHub's 10s webhook deadline
//
// Selection happens in apps/ingest/src/deps.ts based on
// KAFKA_TRANSPORT={memory|kafkajs}. kafkajs is production default.

import {
  type Admin,
  CompressionTypes,
  Kafka,
  logLevel,
  type Producer,
  type ProducerConfig,
  type RecordMetadata,
} from "kafkajs";
import { logger } from "../logger";
import type { WebhookBusMessage, WebhookBusProducer } from "./webhookBus";

export interface KafkaWebhookBusConfig {
  brokers: string[];
  clientId?: string;
  /** ms to wait for broker ack. GitHub gives us 10s. Default 5000. */
  requestTimeout?: number;
  /** Per-request transaction timeout ms. Default 30000 (kafkajs default). */
  transactionalTimeout?: number;
  /** Preconnect at construction time; tests pass `false`. Default true in prod. */
  autoConnect?: boolean;
  /** Allow the producer to fail fast during tests instead of retrying forever. */
  retry?: ProducerConfig["retry"];
}

export class KafkaWebhookBus implements WebhookBusProducer {
  private readonly producer: Producer;
  private readonly kafka: Kafka;
  private connected = false;
  private connecting: Promise<void> | null = null;
  private closed = false;

  constructor(private readonly config: KafkaWebhookBusConfig) {
    this.kafka = new Kafka({
      clientId: config.clientId ?? "bematist-ingest",
      brokers: config.brokers,
      // Quiet the library — pino from the ingest already structures logs.
      logLevel: logLevel.WARN,
      logCreator:
        () =>
        ({ level, log }) => {
          const msg = log.message ?? "kafkajs-log";
          if (level >= logLevel.ERROR) logger.error({ kafkajs: log }, msg);
          else if (level >= logLevel.WARN) logger.warn({ kafkajs: log }, msg);
          else logger.info({ kafkajs: log }, msg);
        },
    });
    this.producer = this.kafka.producer({
      // idempotent producer: enables producer-side dedup by sequence number.
      idempotent: true,
      // acks=all — wait for all in-sync replicas. See PRD §7.1.
      // (kafkajs's `Producer` has no direct `acks` knob; idempotent=true
      // implies acks=-1.)
      transactionTimeout: config.transactionalTimeout ?? 30_000,
      retry: config.retry ?? { retries: 3, maxRetryTime: 5_000 },
      maxInFlightRequests: 5,
    });
  }

  private async ensureConnected(): Promise<void> {
    if (this.connected) return;
    if (this.closed) throw new Error("webhook-bus:closed");
    if (this.connecting) {
      await this.connecting;
      return;
    }
    this.connecting = this.producer
      .connect()
      .then(() => {
        this.connected = true;
      })
      .finally(() => {
        this.connecting = null;
      });
    await this.connecting;
  }

  async publish(topic: string, msg: WebhookBusMessage): Promise<void> {
    if (this.closed) throw new Error("webhook-bus:closed");
    await this.ensureConnected();
    const res: RecordMetadata[] = await this.producer.send({
      topic,
      acks: -1, // belt + suspenders with idempotent=true
      timeout: this.config.requestTimeout ?? 5_000,
      compression: CompressionTypes.None,
      messages: [
        {
          key: msg.key,
          value: Buffer.from(msg.value),
          headers: msg.headers as Record<string, string | Buffer>,
        },
      ],
    });
    // kafkajs returns [] on no-ack configs; with acks=-1 we expect exactly 1.
    if (res.length === 0) {
      throw new Error("kafka-webhook-bus: producer.send returned no metadata");
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      await this.producer.disconnect();
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        "kafka-webhook-bus: disconnect error",
      );
    }
  }

  /** Test/ops helper: ensure topic exists with the locked partition count. */
  async ensureTopic(topic: string, partitions = 32): Promise<void> {
    const admin: Admin = this.kafka.admin();
    try {
      await admin.connect();
      const existing = await admin.listTopics();
      if (!existing.includes(topic)) {
        await admin.createTopics({
          topics: [{ topic, numPartitions: partitions, replicationFactor: 1 }],
          waitForLeaders: true,
        });
      }
    } finally {
      try {
        await admin.disconnect();
      } catch {
        // ignore
      }
    }
  }
}

export function createKafkaWebhookBus(config: KafkaWebhookBusConfig): KafkaWebhookBus {
  return new KafkaWebhookBus(config);
}

/**
 * Parse `KAFKA_BROKERS`/`REDPANDA_BROKERS` env. Comma-separated; drop
 * empty segments; defaults to `localhost:9092`.
 */
export function parseBrokersEnv(env: NodeJS.ProcessEnv): string[] {
  const raw = env.KAFKA_BROKERS ?? env.REDPANDA_BROKERS ?? "";
  const parts = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (parts.length > 0) return parts;
  return ["localhost:9092"];
}
