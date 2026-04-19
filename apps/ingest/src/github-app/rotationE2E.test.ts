// G2 — end-to-end rotation dual-accept test.
//
// Scenario:
//   1. Seed an installation with secret "OLD".
//   2. Sign a webhook body with OLD. Verify → ok (active path).
//   3. Admin calls the `rotateWebhookSecret` mutation to rotate to "NEW".
//      This swaps the columns: previous_ref=OLD, active_ref=NEW.
//   4. A fresh webhook signed with NEW verifies via the active path.
//   5. A fresh webhook signed with OLD verifies via the FALLBACK path
//      (within the 10-minute window).
//   6. Advance the clock past 10 minutes → OLD is rejected because the
//      window has closed.
//
// Uses real installation resolver + secrets resolver in-process. The
// rotation mutation writes to a fake Postgres and the resolvers read
// from an in-memory map updated by the test harness — this exercises
// the full contract surface between the admin-API mutation and the
// webhook-route verifier without a live DB.

import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import type { Ctx } from "../../../../packages/api/src/auth";
import { rotateWebhookSecret } from "../../../../packages/api/src/mutations/github/rotateWebhookSecret";
import type { WebhookDelivery } from "../webhooks/verify";
import { createInMemoryInstallationResolver } from "./installationResolver";
import { createInMemoryWebhookSecretResolver } from "./secretsResolver";
import { verifyWithRotation } from "./verifyWithRotation";

const TENANT = "00000000-0000-0000-0000-000000000001";
const ACTOR = "11111111-1111-4111-8111-111111111111";
const INSTALLATION_ID_STR = "42424242";
const INSTALLATION_ID = 42424242n;

function signGithub(secret: Buffer, body: Uint8Array): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

describe("rotation E2E — admin rotate → dual-accept → window expiry", () => {
  test("OLD stays valid in window; NEW is the active; OLD rejected after expiry", async () => {
    // ----- Arrange ---------------------------------------------------------
    const secretsResolver = createInMemoryWebhookSecretResolver({
      "sm/old-ref": "super-old-secret-bytes",
      "sm/new-ref": "super-new-secret-bytes",
    });
    const installationResolver = createInMemoryInstallationResolver();
    installationResolver.seed({
      tenant_id: TENANT,
      installation_id: INSTALLATION_ID,
      github_org_id: 99n,
      github_org_login: "rotation-e2e-org",
      app_id: 1234n,
      status: "active",
      token_ref: "sm/token",
      webhook_secret_active_ref: "sm/old-ref",
      webhook_secret_previous_ref: null,
      webhook_secret_rotated_at: null,
    });

    // ----- Act 1 — pre-rotation: OLD verifies ------------------------------
    const body = new TextEncoder().encode('{"action":"opened"}');
    const delivery: WebhookDelivery = {
      source: "github",
      deliveryId: "d-1",
      event: "pull_request",
      rawBody: body,
      signature: signGithub(Buffer.from("super-old-secret-bytes"), body),
    };
    const preRotation = await installationResolver.byInstallationId(INSTALLATION_ID);
    expect(preRotation).not.toBeNull();
    if (!preRotation) throw new Error("installation missing pre-rotation");
    const v0 = await verifyWithRotation({
      installation: preRotation,
      resolver: secretsResolver,
      delivery,
    });
    expect(v0.ok).toBe(true);
    if (v0.ok) expect(v0.path).toBe("active");

    // ----- Act 2 — admin rotates -------------------------------------------
    const rotatedAt = new Date("2026-04-18T12:00:00.000Z");
    // Fake Postgres that returns the installation + performs the two-column
    // swap in-memory (mirroring the real UPDATE ... RETURNING shape).
    let fakeActive = "sm/old-ref";
    let fakePrev: string | null = null;
    const ctx: Ctx = {
      tenant_id: TENANT,
      actor_id: ACTOR,
      role: "admin",
      db: {
        pg: {
          async query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]> {
            if (/SELECT installation_id/i.test(sql)) {
              return [{ installation_id: INSTALLATION_ID_STR }] as unknown as T[];
            }
            if (/UPDATE github_installations/i.test(sql)) {
              const newRef = params?.[2] as string;
              fakePrev = fakeActive;
              fakeActive = newRef;
              // Also push the rotation into the installation resolver so the
              // webhook route sees the swap.
              installationResolver.rotate(INSTALLATION_ID, {
                active_ref: newRef,
                previous_ref: fakePrev,
                rotated_at: rotatedAt,
              });
              return [
                {
                  webhook_secret_previous_ref: fakePrev,
                  webhook_secret_active_ref: fakeActive,
                  webhook_secret_rotated_at: rotatedAt,
                },
              ] as unknown as T[];
            }
            return [];
          },
        },
        ch: {
          async query() {
            return [];
          },
        },
        redis: {
          async get() {
            return null;
          },
          async set() {},
          async setNx() {
            return true;
          },
        },
      },
    };

    const out = await rotateWebhookSecret(
      ctx,
      { new_secret_ref: "sm/new-ref" },
      { now: () => rotatedAt },
    );
    expect(out.new_secret_ref).toBe("sm/new-ref");
    expect(out.installation_id).toBe(INSTALLATION_ID_STR);

    const afterRotation = await installationResolver.byInstallationId(INSTALLATION_ID);
    expect(afterRotation).not.toBeNull();
    if (!afterRotation) throw new Error("installation missing after rotation");

    // ----- Act 3 — after rotation: NEW verifies via active path -----------
    const bodyNew = new TextEncoder().encode('{"action":"edited"}');
    const deliveryNew: WebhookDelivery = {
      source: "github",
      deliveryId: "d-2",
      event: "pull_request",
      rawBody: bodyNew,
      signature: signGithub(Buffer.from("super-new-secret-bytes"), bodyNew),
    };
    const v1 = await verifyWithRotation({
      installation: afterRotation,
      resolver: secretsResolver,
      delivery: deliveryNew,
      now: () => new Date(rotatedAt.getTime() + 2 * 60_000), // 2 min post-rotation
    });
    expect(v1.ok).toBe(true);
    if (v1.ok) expect(v1.path).toBe("active");

    // ----- Act 4 — within window, OLD verifies via fallback path ----------
    const bodyOldSigned = new TextEncoder().encode('{"action":"synchronize"}');
    const deliveryOldSigned: WebhookDelivery = {
      source: "github",
      deliveryId: "d-3",
      event: "pull_request",
      rawBody: bodyOldSigned,
      signature: signGithub(Buffer.from("super-old-secret-bytes"), bodyOldSigned),
    };
    const v2 = await verifyWithRotation({
      installation: afterRotation,
      resolver: secretsResolver,
      delivery: deliveryOldSigned,
      now: () => new Date(rotatedAt.getTime() + 5 * 60_000), // 5 min post-rotation
    });
    expect(v2.ok).toBe(true);
    if (v2.ok) expect(v2.path).toBe("fallback");

    // ----- Act 5 — past 10-min window, OLD rejected -----------------------
    const v3 = await verifyWithRotation({
      installation: afterRotation,
      resolver: secretsResolver,
      delivery: deliveryOldSigned,
      now: () => new Date(rotatedAt.getTime() + 11 * 60_000), // 11 min post-rotation
    });
    expect(v3.ok).toBe(false);
    if (!v3.ok) expect(v3.reason).toBe("active_mismatch_window_expired");
  });
});
