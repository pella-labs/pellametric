// Transport-toggle test (G2): both in-memory and kafkajs buses satisfy the
// same `WebhookBusProducer` interface, so the ingest webhook route works
// against either transport with zero code-path branching.
//
// Memory path runs ALWAYS (fast unit test). The kafkajs path is opt-in
// behind `E2E_KAFKA=1` so CI can skip when no broker is available.

import { describe, expect, test } from "bun:test";
import type { WebhookBusProducer } from "./webhookBus";
import { createInMemoryWebhookBus, GITHUB_WEBHOOKS_TOPIC } from "./webhookBus";

const ENABLED_KAFKA = process.env.E2E_KAFKA === "1";
const BROKERS = (process.env.KAFKA_BROKERS ?? "localhost:9092")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

async function withBus(bus: WebhookBusProducer, topic: string): Promise<void> {
  await bus.publish(topic, {
    key: "t-1:42",
    value: new TextEncoder().encode(JSON.stringify({ x: 1 })),
    headers: { "x-github-event": "push" },
  });
  // Close-is-idempotent contract (matches WebhookBusProducer).
  await bus.close();
  await bus.close();
}

describe("transport toggle", () => {
  test("KAFKA_TRANSPORT=memory — in-memory bus publishes successfully", async () => {
    const bus = createInMemoryWebhookBus();
    await withBus(bus, GITHUB_WEBHOOKS_TOPIC);
    // Publishing after close should reject.
    await expect(
      bus.publish(GITHUB_WEBHOOKS_TOPIC, {
        key: "x",
        value: new Uint8Array(),
        headers: {},
      }),
    ).rejects.toThrow(/closed/);
  });

  test.skipIf(!ENABLED_KAFKA)(
    "KAFKA_TRANSPORT=kafkajs — kafka bus publishes successfully",
    async () => {
      const { createKafkaWebhookBus } = await import("./kafkaWebhookBus");
      const topic = `toggle.e2e-${Date.now()}`;
      const bus = createKafkaWebhookBus({
        brokers: BROKERS,
        clientId: "toggle-producer",
      });
      await bus.ensureTopic(topic, 1);
      await withBus(bus, topic);
      // After close, the bus must refuse publish — matching the memory bus.
      await expect(
        bus.publish(topic, {
          key: "x",
          value: new Uint8Array(),
          headers: {},
        }),
      ).rejects.toThrow(/closed/);
      // Cleanup topic
      try {
        const { Kafka } = await import("kafkajs");
        const kafka = new Kafka({ brokers: BROKERS, clientId: "toggle-cleanup" });
        const admin = kafka.admin();
        await admin.connect();
        await admin.deleteTopics({ topics: [topic] });
        await admin.disconnect();
      } catch {
        // swallow
      }
    },
    30_000,
  );
});
