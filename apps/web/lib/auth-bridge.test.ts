// Unit tests for the Better-Auth → internal-users bridge. Pure logic —
// every dep is stubbed so these run in <10ms without a DB.

import { beforeEach, describe, expect, test } from "bun:test";
import { type BridgeDeps, bridgeBetterAuthUser } from "./auth-bridge";

function makeStubs(overrides: Partial<BridgeDeps> = {}): BridgeDeps & {
  _state: {
    usersByBAId: Map<string, { id: string; orgId: string; role: string }>;
    usersByEmail: Map<
      string,
      { id: string; orgId: string; role: string; betterAuthUserId: string | null }
    >;
    orgCount: Map<string, number>;
    createdUsers: Array<{
      orgId: string;
      ssoSubject: string;
      email: string;
      role: string;
      betterAuthUserId: string;
    }>;
    linkCalls: Array<{ userId: string; betterAuthUserId: string }>;
    defaultOrgId: string;
  };
} {
  const state = {
    usersByBAId: new Map<string, { id: string; orgId: string; role: string }>(),
    usersByEmail: new Map<
      string,
      { id: string; orgId: string; role: string; betterAuthUserId: string | null }
    >(),
    orgCount: new Map<string, number>(),
    createdUsers: [] as Array<{
      orgId: string;
      ssoSubject: string;
      email: string;
      role: string;
      betterAuthUserId: string;
    }>,
    linkCalls: [] as Array<{ userId: string; betterAuthUserId: string }>,
    defaultOrgId: "org-default",
  };

  const base: BridgeDeps = {
    countUsersInOrg: async (orgId) => state.orgCount.get(orgId) ?? 0,
    findUserByBetterAuthId: async (id) => state.usersByBAId.get(id) ?? null,
    findUserByEmail: async (email) => state.usersByEmail.get(email) ?? null,
    getOrCreateDefaultOrg: async () => state.defaultOrgId,
    linkBetterAuthIdToUser: async (userId, betterAuthUserId) => {
      state.linkCalls.push({ userId, betterAuthUserId });
      // Reflect the link in the fake DB too so a follow-up lookup sees it.
      const found = Array.from(state.usersByEmail.entries()).find(([, u]) => u.id === userId);
      if (found) {
        state.usersByEmail.set(found[0], { ...found[1], betterAuthUserId });
        state.usersByBAId.set(betterAuthUserId, {
          id: found[1].id,
          orgId: found[1].orgId,
          role: found[1].role,
        });
      }
    },
    createUser: async (params) => {
      state.createdUsers.push(params);
      const newId = `user-${state.createdUsers.length}`;
      state.usersByBAId.set(params.betterAuthUserId, {
        id: newId,
        orgId: params.orgId,
        role: params.role,
      });
      state.usersByEmail.set(params.email, {
        id: newId,
        orgId: params.orgId,
        role: params.role,
        betterAuthUserId: params.betterAuthUserId,
      });
      state.orgCount.set(params.orgId, (state.orgCount.get(params.orgId) ?? 0) + 1);
      return newId;
    },
    ...overrides,
  };

  return Object.assign(base, { _state: state });
}

describe("bridgeBetterAuthUser — path 1: already bridged", () => {
  test("returns existing (userId, orgId, role) without side effects", async () => {
    const deps = makeStubs();
    deps._state.usersByBAId.set("ba-1", {
      id: "user-99",
      orgId: "org-x",
      role: "admin",
    });

    const result = await bridgeBetterAuthUser(deps, {
      betterAuthUserId: "ba-1",
      email: "ignored@example.com",
    });

    expect(result).toEqual({
      action: "already_bridged",
      userId: "user-99",
      orgId: "org-x",
      role: "admin",
    });
    expect(deps._state.createdUsers).toHaveLength(0);
    expect(deps._state.linkCalls).toHaveLength(0);
  });

  test("normalizes unrecognized role to `ic`", async () => {
    const deps = makeStubs();
    deps._state.usersByBAId.set("ba-2", {
      id: "user-2",
      orgId: "org-y",
      role: "superuser",
    });

    const result = await bridgeBetterAuthUser(deps, {
      betterAuthUserId: "ba-2",
      email: "weird@example.com",
    });

    expect(result.role).toBe("ic");
    expect(result.action).toBe("already_bridged");
  });
});

describe("bridgeBetterAuthUser — path 2: claim pre-seeded invite", () => {
  test("links Better Auth id to existing email-only row; preserves role", async () => {
    const deps = makeStubs();
    deps._state.usersByEmail.set("invitee@example.com", {
      id: "user-seed",
      orgId: "org-seed",
      role: "admin",
      betterAuthUserId: null,
    });

    const result = await bridgeBetterAuthUser(deps, {
      betterAuthUserId: "ba-new",
      email: "invitee@example.com",
    });

    expect(result).toEqual({
      action: "claimed_existing_invite",
      userId: "user-seed",
      orgId: "org-seed",
      role: "admin",
    });
    expect(deps._state.linkCalls).toEqual([{ userId: "user-seed", betterAuthUserId: "ba-new" }]);
    expect(deps._state.createdUsers).toHaveLength(0);
  });

  test("does NOT claim when the matching email row already has a Better Auth id", async () => {
    const deps = makeStubs();
    // Simulate: someone else already claimed this email. The new Better
    // Auth identity falls through to path 3 (fresh user creation).
    deps._state.usersByEmail.set("collision@example.com", {
      id: "user-taken",
      orgId: "org-taken",
      role: "admin",
      betterAuthUserId: "ba-someone-else",
    });

    const result = await bridgeBetterAuthUser(deps, {
      betterAuthUserId: "ba-collider",
      email: "collision@example.com",
    });

    expect(result.action).toBe("created_new_user");
    expect(deps._state.createdUsers).toHaveLength(1);
    expect(deps._state.linkCalls).toHaveLength(0);
  });
});

describe("bridgeBetterAuthUser — path 3: fresh user creation", () => {
  test("first user in the org lands as `ic` — no auto-admin promotion", async () => {
    const deps = makeStubs();
    // Empty org → first user → still `ic`. Admin is granted explicitly
    // out-of-band; sign-in ordering must not confer tenant-admin rights
    // (the /card flow funnels strangers through OAuth).
    const result = await bridgeBetterAuthUser(deps, {
      betterAuthUserId: "ba-first",
      email: "first@example.com",
    });

    expect(result.action).toBe("created_new_user");
    expect(result.role).toBe("ic");
    expect(result.orgId).toBe("org-default");
    expect(deps._state.createdUsers[0]).toMatchObject({
      orgId: "org-default",
      email: "first@example.com",
      role: "ic",
      ssoSubject: "github:ba-first",
      betterAuthUserId: "ba-first",
    });
  });

  test("subsequent users in the same org also land as `ic`", async () => {
    const deps = makeStubs();
    // Seed the org with an existing user. Role outcome is identical to the
    // empty-org case now that first-user-admin is gone.
    deps._state.orgCount.set("org-default", 1);

    const result = await bridgeBetterAuthUser(deps, {
      betterAuthUserId: "ba-second",
      email: "second@example.com",
    });

    expect(result.action).toBe("created_new_user");
    expect(result.role).toBe("ic");
    expect(deps._state.createdUsers[0]?.role).toBe("ic");
  });

  test("ssoSubject is namespaced by `github:` prefix to prevent cross-provider collisions", async () => {
    const deps = makeStubs();
    await bridgeBetterAuthUser(deps, {
      betterAuthUserId: "ba-abc",
      email: "x@example.com",
    });
    expect(deps._state.createdUsers[0]?.ssoSubject).toBe("github:ba-abc");
  });

  test("two sign-ins with different emails produce two distinct users; both `ic`", async () => {
    const deps = makeStubs();

    const a = await bridgeBetterAuthUser(deps, {
      betterAuthUserId: "ba-a",
      email: "a@example.com",
    });
    const b = await bridgeBetterAuthUser(deps, {
      betterAuthUserId: "ba-b",
      email: "b@example.com",
    });

    expect(a.role).toBe("ic");
    expect(b.role).toBe("ic");
    expect(a.userId).not.toBe(b.userId);
    expect(deps._state.createdUsers).toHaveLength(2);
  });
});

describe("bridgeBetterAuthUser — idempotency on replay", () => {
  let deps: ReturnType<typeof makeStubs>;
  beforeEach(() => {
    deps = makeStubs();
  });

  test("calling twice with the same Better Auth id is a no-op the second time", async () => {
    const first = await bridgeBetterAuthUser(deps, {
      betterAuthUserId: "ba-same",
      email: "same@example.com",
    });
    const second = await bridgeBetterAuthUser(deps, {
      betterAuthUserId: "ba-same",
      email: "same@example.com",
    });

    expect(first.action).toBe("created_new_user");
    expect(second.action).toBe("already_bridged");
    expect(second.userId).toBe(first.userId);
    expect(deps._state.createdUsers).toHaveLength(1);
  });
});
