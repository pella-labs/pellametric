import { describe, expect, test } from "bun:test";
import type { Ctx } from "../auth";
import { setNotificationPref } from "../mutations/policy";
import { getEffectivePolicy } from "./policy";

describe("getEffectivePolicy", () => {
  test("returns the D7 defaults for a fresh tenant", async () => {
    const out = await getEffectivePolicy(makeCtx("engineer"), {});
    expect(out.tier).toBe("B");
    expect(out.retention_days).toBe(90);
    expect(out.notifications.manager_view).toBe("daily");
    expect(out.ai_assisted_trailer).toBe(false);
    expect(out.redaction.trufflehog).toBe(true);
    expect(out.redaction.gitleaks).toBe(true);
    expect(out.redaction.presidio_ner).toBe(true);
    expect(out.tier_c_signed_config).toBeNull();
    expect(out.tier_c_managed_cloud_optin).toBe(false);
  });

  test("viewer, auditor, admin all allowed to read", async () => {
    for (const role of ["viewer", "auditor", "admin"] as const) {
      const out = await getEffectivePolicy(makeCtx(role), {});
      expect(out.tenant_id).toBe("test-tenant");
    }
  });
});

describe("setNotificationPref", () => {
  test("engineer can set their own manager_view preference", async () => {
    const out = await setNotificationPref(makeCtx("engineer"), {
      manager_view: "immediate",
    });
    expect(out.manager_view).toBe("immediate");
    expect(new Date(out.updated_at).toString()).not.toBe("Invalid Date");
  });

  test("manager role is rejected (this is an IC-owned setting)", async () => {
    await expect(
      setNotificationPref(makeCtx("manager"), { manager_view: "off" }),
    ).rejects.toThrow();
  });
});

function makeCtx(role: "admin" | "manager" | "engineer" | "auditor" | "viewer" = "manager"): Ctx {
  return {
    tenant_id: "test-tenant",
    actor_id: "test-actor",
    role,
    db: {
      pg: { query: async () => [] },
      ch: { query: async () => [] },
      redis: {
        get: async () => null,
        set: async () => undefined,
        setNx: async () => true,
      },
    },
  };
}
