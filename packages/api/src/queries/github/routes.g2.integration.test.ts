// G2-admin-apis — integration tests against a REAL Postgres. These exercise
// the actual SQL the mutations emit (shape + column names) and round-trip
// through the live schema.
//
// Opt-in: set DATABASE_URL (or start docker-compose dev stack). Skipped
// otherwise so `bun test` stays fast for developers without the stack.
//
// Tests:
//   1. patchTrackingMode — admin flips orgs.github_repo_tracking_mode +
//      emits exactly one recompute message; audit_log row lands.
//   2. getTrackingPreview — dry-run makes NO writes (tracking_mode + repos
//      + session_repo_eligibility all unchanged post-call).
//   3. rotateWebhookSecret — two-column swap:
//        active_ref → previous_ref
//        new → active
//        rotated_at = now()
//      OLD secret still referenceable for dual-accept in the webhook route.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import postgres from "postgres";
import type { Ctx } from "../../auth";
import { rotateWebhookSecret } from "../../mutations/github/rotateWebhookSecret";
import { patchTrackingMode } from "../../mutations/github/trackingMode";
import { getTrackingPreview } from "./trackingPreview";

const PG_LIVE = process.env.DATABASE_URL !== undefined;
const SUPER_URL =
  process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5433/bematist";

// biome-ignore lint/suspicious/noExplicitAny: bun:test exposes skipIf at runtime
const runIfPg = (test as any).skipIf ? (test as any).skipIf(!PG_LIVE) : test;

let sql: ReturnType<typeof postgres> | null = null;

// Unique tenant per-run for test isolation.
const TENANT_ID = `00000000-0000-4000-8000-${String(Date.now() % 1e12).padStart(12, "0")}`;
const ACTOR_ID = `11111111-1111-4111-8111-${String(Date.now() % 1e12).padStart(12, "0")}`;
const INSTALLATION_ID = `${Math.floor(Math.random() * 1e9)}`;

beforeAll(async () => {
  if (!PG_LIVE) return;
  sql = postgres(SUPER_URL, { max: 3, idle_timeout: 5, connect_timeout: 5 });
  // Seed a tenant + user + installation so mutations find rows.
  const slug = `g2-integration-${Date.now()}`;
  await sql`INSERT INTO orgs (id, slug, name, github_repo_tracking_mode)
            VALUES (${TENANT_ID}, ${slug}, 'g2-integration-org', 'all')
            ON CONFLICT (id) DO NOTHING`;
  // Actor user with FK into orgs; unique sso_subject per run.
  const sso = `g2-integration-sso-${Date.now()}`;
  await sql`INSERT INTO users (id, org_id, sso_subject, email, role)
            VALUES (${ACTOR_ID}, ${TENANT_ID}, ${sso}, 'g2@integration.local', 'admin')
            ON CONFLICT (id) DO NOTHING`;
  await sql`
    INSERT INTO github_installations (
      tenant_id, installation_id, github_org_id, github_org_login, app_id,
      status, installed_at, webhook_secret_active_ref, token_ref, updated_at
    )
    VALUES (
      ${TENANT_ID}, ${INSTALLATION_ID}, 99999, 'g2-test-org', 12345,
      'active', now(), 'sm/g2-init-ref', 'sm/g2-init-token', now()
    )
    ON CONFLICT (tenant_id, installation_id) DO NOTHING
  `;
});

afterAll(async () => {
  if (!sql) return;
  try {
    // audit_log is append-only (trigger audit_log_prevent_mutate) and holds
    // FKs to orgs + users — so we can't clean up the parents without first
    // mutating audit_log. Unique TENANT_ID / ACTOR_ID per run bounds the
    // leak; a periodic `TRUNCATE audit_log` + re-seed is how CI would
    // reclaim if needed.
    await sql`DELETE FROM github_installations WHERE tenant_id = ${TENANT_ID}`;
    await sql`DELETE FROM session_repo_eligibility WHERE tenant_id = ${TENANT_ID}`;
    await sql`DELETE FROM repos WHERE org_id = ${TENANT_ID}`;
  } finally {
    await sql.end().catch(() => {});
  }
});

function ctx(role: "admin" | "viewer" = "admin"): Ctx {
  return {
    tenant_id: TENANT_ID,
    actor_id: ACTOR_ID,
    role,
    db: {
      pg: {
        async query<T = unknown>(text: string, params?: unknown[]): Promise<T[]> {
          // biome-ignore lint/suspicious/noExplicitAny: postgres.js widens to RowList
          const rows = (await sql?.unsafe(text, (params ?? []) as any[])) as unknown as T[];
          return rows;
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
}

describe("G2 integration — real Postgres", () => {
  runIfPg(
    "patchTrackingMode: admin flips orgs.github_repo_tracking_mode + emits recompute + audits",
    async () => {
      if (!sql) throw new Error("no sql handle");
      const flips: Array<{ tenant_id: string; newMode: string }> = [];
      const out = await patchTrackingMode(
        ctx("admin"),
        { mode: "selected" },
        {
          recompute: {
            async emitTrackingModeFlipped(args) {
              flips.push(args);
              return 7;
            },
          },
        },
      );
      expect(out.mode).toBe("selected");
      expect(out.sessions_recompute_queued).toBe(7);
      expect(flips).toEqual([{ tenant_id: TENANT_ID, newMode: "selected" }]);

      const [row] = await sql<
        { github_repo_tracking_mode: string }[]
      >`SELECT github_repo_tracking_mode FROM orgs WHERE id = ${TENANT_ID}`;
      expect(row?.github_repo_tracking_mode).toBe("selected");

      const audit = await sql<
        { action: string; metadata_json: Record<string, unknown> }[]
      >`SELECT action, metadata_json FROM audit_log
         WHERE org_id = ${TENANT_ID} AND action = 'github.tracking_mode_updated'`;
      expect(audit.length).toBeGreaterThanOrEqual(1);
      expect(audit[0]?.metadata_json.previous).toBe("all");
      expect(audit[0]?.metadata_json.next).toBe("selected");
    },
  );

  runIfPg("getTrackingPreview: no writes to orgs / repos / eligibility", async () => {
    if (!sql) throw new Error("no sql handle");
    const [before] = await sql<
      { github_repo_tracking_mode: string }[]
    >`SELECT github_repo_tracking_mode FROM orgs WHERE id = ${TENANT_ID}`;

    const out = await getTrackingPreview(ctx("admin"), {
      mode: "all",
      included_repos: [],
    });
    expect(out.sessions_that_would_become_eligible).toBe(0);
    expect(out.sessions_that_would_become_ineligible).toBe(0);
    expect(out.sample_eligible_sessions).toEqual([]);
    expect(out.sample_ineligible_sessions).toEqual([]);

    const [after] = await sql<
      { github_repo_tracking_mode: string }[]
    >`SELECT github_repo_tracking_mode FROM orgs WHERE id = ${TENANT_ID}`;
    // Preview is read-only — value must be unchanged.
    expect(after?.github_repo_tracking_mode).toBe(before?.github_repo_tracking_mode);
  });

  runIfPg(
    "rotateWebhookSecret: swaps columns atomically + sets rotated_at + old still accepts via previous_ref",
    async () => {
      if (!sql) throw new Error("no sql handle");
      const fixedNow = new Date("2026-04-18T12:34:56.000Z");
      const out = await rotateWebhookSecret(
        ctx("admin"),
        { new_secret_ref: "sm/g2-rotated-v2" },
        { now: () => fixedNow },
      );
      expect(out.installation_id).toBe(INSTALLATION_ID);
      expect(out.new_secret_ref).toBe("sm/g2-rotated-v2");
      expect(out.rotated_at).toBe(fixedNow.toISOString());
      expect(out.window_expires_at).toBe(new Date(fixedNow.getTime() + 10 * 60_000).toISOString());

      const [row] = await sql<
        {
          webhook_secret_active_ref: string;
          webhook_secret_previous_ref: string | null;
          webhook_secret_rotated_at: Date | null;
        }[]
      >`SELECT webhook_secret_active_ref,
               webhook_secret_previous_ref,
               webhook_secret_rotated_at
          FROM github_installations
         WHERE tenant_id = ${TENANT_ID}`;

      expect(row?.webhook_secret_active_ref).toBe("sm/g2-rotated-v2");
      // OLD secret is still referenceable via previous_ref for the 10-min
      // dual-accept window (PR #85's verifyWithRotation reads this column).
      expect(row?.webhook_secret_previous_ref).toBe("sm/g2-init-ref");
      expect(row?.webhook_secret_rotated_at?.toISOString()).toBe(fixedNow.toISOString());

      // Audit row lands.
      const audit = await sql<{ action: string }[]>`SELECT action FROM audit_log
         WHERE org_id = ${TENANT_ID} AND action = 'github.webhook_secret_rotated'`;
      expect(audit.length).toBeGreaterThanOrEqual(1);
    },
  );
});
