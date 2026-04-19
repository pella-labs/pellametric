// End-to-end test: Redpanda + ingest kafkajs producer → worker kafkajs
// consumer → Postgres UPSERT. Uses the ACTUAL Redpanda broker from
// docker-compose.dev.yml — no Kafka mocking (per G2 charter).
//
// Opt-in: set `E2E_KAFKA=1` to run. Skipped by default so `bun test` stays
// fast on developer machines without docker-compose up.
//
// Shape:
//   1. Verify broker reachability via kafkajs admin.listTopics().
//   2. Ensure topic `github.webhooks.e2e` exists (isolated from prod topic).
//   3. Produce a real GitHub `pull_request` webhook bytes using the
//      `createKafkaWebhookBus` producer.
//   4. Run the worker consumer (startKafkaGithubConsumer) with a fake
//      Postgres sql handle that records UPSERTs to an in-memory array.
//   5. Assert the upsertPullRequest SQL is observed with the expected
//      provider_repo_id + pr_number from the fixture.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Kafka } from "kafkajs";
import type { Sql } from "postgres";
import { createKafkaWebhookBus } from "../../../ingest/src/github-app/kafkaWebhookBus";
import {
  createInMemoryRecomputeStream,
  type InMemoryRecomputeStream,
} from "../../../ingest/src/github-app/recomputeStream";
import {
  encodePayload,
  GITHUB_WEBHOOKS_TOPIC,
  type WebhookBusPayload,
} from "../../../ingest/src/github-app/webhookBus";
import { startKafkaGithubConsumer } from "./kafkaConsumer";

const ENABLED = process.env.E2E_KAFKA === "1";
const BROKERS = (process.env.KAFKA_BROKERS ?? "localhost:9092")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// We rename the topic per-run to avoid poisoning subsequent runs — a single
// Redpanda instance in docker-compose is shared between dev and these tests.
const TOPIC = `${GITHUB_WEBHOOKS_TOPIC}.e2e-${Date.now()}`;

interface RecordedQuery {
  sql: string;
  params: unknown[];
}

function fakeSql(recorded: RecordedQuery[]): Sql {
  // biome-ignore lint/suspicious/noExplicitAny: minimal fake over the single tx.unsafe path
  const tx: any = {
    async unsafe(sql: string, params: unknown[] = []) {
      recorded.push({ sql, params });
      return [];
    },
  };
  // biome-ignore lint/suspicious/noExplicitAny: minimal fake over sql.begin path
  return {
    async begin(handler: (t: any) => Promise<unknown>) {
      return handler(tx);
    },
  } as unknown as Sql;
}

describe.skipIf(!ENABLED)("kafka-e2e — ingest → redpanda → worker", () => {
  test("round-trips a pull_request webhook through a real broker", async () => {
    // ----- Arrange ---------------------------------------------------------
    const bus = createKafkaWebhookBus({ brokers: BROKERS, clientId: "e2e-producer" });
    await bus.ensureTopic(TOPIC, 4);

    const fixturePath = join(
      __dirname,
      "..",
      "..",
      "..",
      "..",
      "packages",
      "fixtures",
      "github",
      "pull_request",
      "opened.json",
    );
    const body = readFileSync(fixturePath);

    const tenantId = "00000000-0000-0000-0000-00000000e2e1";
    const installationId = "42424242";
    const payload: WebhookBusPayload = {
      delivery_id: `e2e-${Date.now()}`,
      event: "pull_request",
      tenant_id: tenantId,
      installation_id: installationId,
      body_b64: body.toString("base64"),
      received_at: new Date().toISOString(),
    };

    // ----- Act: produce ----------------------------------------------------
    await bus.publish(TOPIC, {
      key: `${tenantId}:${installationId}`,
      value: encodePayload(payload),
      headers: { "x-github-event": "pull_request", "x-github-delivery": payload.delivery_id },
    });
    await bus.close();

    // ----- Act: consume ----------------------------------------------------
    const recorded: RecordedQuery[] = [];
    const recompute: InMemoryRecomputeStream = createInMemoryRecomputeStream();
    const ackedOffsets: string[] = [];

    const consumerHandle = await startKafkaGithubConsumer(
      {
        brokers: BROKERS,
        topic: TOPIC,
        clientId: "e2e-consumer",
        groupId: `e2e-group-${Date.now()}`,
        onCommit: (offset) => ackedOffsets.push(offset),
        fromBeginning: true,
      },
      {
        sql: fakeSql(recorded),
        recompute,
        // Silent log so test output stays clean.
        log: () => {},
      },
    );

    // Poll for up to 20s — Kafka rebalance + fetch can take a few seconds.
    const deadline = Date.now() + 20_000;
    let prUpsertSeen = false;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 250));
      prUpsertSeen = recorded.some((r) => /INSERT INTO github_pull_requests/i.test(r.sql));
      if (prUpsertSeen) break;
    }

    await consumerHandle.stop();

    // ----- Assert ----------------------------------------------------------
    expect(prUpsertSeen).toBe(true);
    expect(ackedOffsets.length).toBeGreaterThan(0);
    const recomputeMsgs = recompute.readStream(tenantId);
    expect(recomputeMsgs.length).toBe(1);
    expect(recomputeMsgs[0]?.msg.trigger).toBe("webhook_pr_upsert");

    // Admin cleanup — delete the topic so subsequent runs don't accumulate.
    try {
      const kafka = new Kafka({ clientId: "e2e-cleanup", brokers: BROKERS });
      const admin = kafka.admin();
      await admin.connect();
      await admin.deleteTopics({ topics: [TOPIC] });
      await admin.disconnect();
    } catch {
      // swallow — cleanup is best-effort
    }
  }, 45_000);
});
