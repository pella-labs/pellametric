// Unit tests for the new-org upgrade (post-auth signup spine). All deps
// are stubbed so these run in <10ms without a DB. Same style as
// `auth-bridge.test.ts`.

import { beforeEach, describe, expect, test } from "bun:test";
import { type UpgradeDeps, upgradeToNewOrg } from "./upgrade-to-new-org";

function makeStubs(overrides: Partial<UpgradeDeps> = {}): UpgradeDeps & {
  _state: {
    orgsById: Map<string, { slug: string; name: string }>;
    slugsTaken: Set<string>;
    users: Map<string, { id: string; orgId: string; role: string; email: string }>;
    promotedUsers: Array<{ userId: string; newOrgId: string }>;
    createdDevelopers: Array<{ orgId: string; userId: string; stableHash: string }>;
    defaultSlug: string;
    suffixQueue: string[];
  };
} {
  const state = {
    orgsById: new Map<string, { slug: string; name: string }>([
      ["org-default", { slug: "default", name: "Default" }],
    ]),
    slugsTaken: new Set<string>(["default"]),
    users: new Map<string, { id: string; orgId: string; role: string; email: string }>(),
    promotedUsers: [] as Array<{ userId: string; newOrgId: string }>,
    createdDevelopers: [] as Array<{ orgId: string; userId: string; stableHash: string }>,
    defaultSlug: "default",
    suffixQueue: ["ab12"] as string[],
  };

  const base: UpgradeDeps = {
    getDefaultOrgSlug: async () => state.defaultSlug,
    findUserById: async (id) => state.users.get(id) ?? null,
    getOrgSlugById: async (orgId) => state.orgsById.get(orgId)?.slug ?? null,
    createOrg: async ({ slugBase, name }) => {
      // Simulate the real query's retry-on-conflict: pick the next
      // available `<base>` or append -2, -3, ... in plain alnum form.
      let candidate = slugBase;
      let n = 2;
      while (state.slugsTaken.has(candidate)) {
        candidate = `${slugBase}${n}`;
        n++;
      }
      state.slugsTaken.add(candidate);
      const newId = `org-new-${state.orgsById.size}`;
      state.orgsById.set(newId, { slug: candidate, name });
      return { orgId: newId, slug: candidate };
    },
    promoteUserToNewOrg: async ({ userId, newOrgId }) => {
      state.promotedUsers.push({ userId, newOrgId });
      const u = state.users.get(userId);
      if (u) {
        state.users.set(userId, { ...u, orgId: newOrgId, role: "admin" });
      }
    },
    createDeveloperRow: async (params) => {
      state.createdDevelopers.push(params);
      return `dev-${state.createdDevelopers.length}`;
    },
    randomSuffix: () => {
      return state.suffixQueue.shift() ?? "zzz";
    },
    ...overrides,
  };

  return Object.assign(base, { _state: state });
}

describe("upgradeToNewOrg — branch 1: user not found", () => {
  test("throws so caller can bounce to sign-in", async () => {
    const deps = makeStubs();
    await expect(
      upgradeToNewOrg(deps, {
        userId: "user-missing",
        githubLogin: "ghost",
        email: "ghost@example.com",
      }),
    ).rejects.toThrow(/user user-missing not found/);
  });
});

describe("upgradeToNewOrg — branch 2: already upgraded (idempotent)", () => {
  test("returns current (orgId, role) without creating a second org", async () => {
    const deps = makeStubs();
    deps._state.orgsById.set("org-existing", { slug: "alreadymine", name: "Already Mine" });
    deps._state.slugsTaken.add("alreadymine");
    deps._state.users.set("user-up", {
      id: "user-up",
      orgId: "org-existing",
      role: "admin",
      email: "a@example.com",
    });

    const result = await upgradeToNewOrg(deps, {
      userId: "user-up",
      githubLogin: "alreadymine",
      email: "a@example.com",
    });

    expect(result).toEqual({
      action: "already_upgraded",
      userId: "user-up",
      orgId: "org-existing",
      developerId: null,
      slug: "alreadymine",
      role: "admin",
    });
    expect(deps._state.promotedUsers).toHaveLength(0);
    expect(deps._state.createdDevelopers).toHaveLength(0);
  });

  test("normalizes a non-admin role from an earlier upgrade to `ic`", async () => {
    // Edge: a user somehow landed in a non-default org as role=ic (invite
    // claim path). Still idempotent — we don't re-promote.
    const deps = makeStubs();
    deps._state.orgsById.set("org-existing", { slug: "teammate", name: "Teammate" });
    deps._state.slugsTaken.add("teammate");
    deps._state.users.set("user-ic", {
      id: "user-ic",
      orgId: "org-existing",
      role: "ic",
      email: "ic@example.com",
    });

    const result = await upgradeToNewOrg(deps, {
      userId: "user-ic",
      githubLogin: "teammate",
      email: "ic@example.com",
    });

    expect(result.action).toBe("already_upgraded");
    expect(result.role).toBe("ic");
  });
});

describe("upgradeToNewOrg — branch 3: create new org", () => {
  let deps: ReturnType<typeof makeStubs>;
  beforeEach(() => {
    deps = makeStubs();
    deps._state.users.set("user-new", {
      id: "user-new-abcdef1234",
      orgId: "org-default",
      role: "ic",
      email: "dev@example.com",
    });
    // Actually we need `users.get("user-new")` to match `findUserById`.
    // Rewrite with correct key:
    deps._state.users.clear();
    deps._state.users.set("user-new-abcdef1234", {
      id: "user-new-abcdef1234",
      orgId: "org-default",
      role: "ic",
      email: "dev@example.com",
    });
  });

  test("creates org, promotes user, creates developer, returns admin", async () => {
    const result = await upgradeToNewOrg(deps, {
      userId: "user-new-abcdef1234",
      githubLogin: "octocat",
      email: "dev@example.com",
    });

    expect(result.action).toBe("created_new_org");
    expect(result.role).toBe("admin");
    expect(result.slug).toBe("octocatab12");
    expect(result.developerId).toBe("dev-1");
    expect(deps._state.promotedUsers).toHaveLength(1);
    expect(deps._state.promotedUsers[0]?.userId).toBe("user-new-abcdef1234");
    expect(deps._state.createdDevelopers).toHaveLength(1);
    expect(deps._state.createdDevelopers[0]?.stableHash).toMatch(/^eng_octocatab12_user-new$/);
  });

  test("retries slug on collision (appends numeric suffix)", async () => {
    // Pre-reserve `octocatab12` so the first create-try collides and
    // the stub retries with `octocatab122`.
    deps._state.slugsTaken.add("octocatab12");

    const result = await upgradeToNewOrg(deps, {
      userId: "user-new-abcdef1234",
      githubLogin: "octocat",
      email: "dev@example.com",
    });

    expect(result.slug).toBe("octocatab122");
  });

  test("falls back to email local-part when githubLogin is missing", async () => {
    deps._state.suffixQueue = ["cd34"];
    const result = await upgradeToNewOrg(deps, {
      userId: "user-new-abcdef1234",
      githubLogin: null,
      email: "alice@example.com",
    });

    expect(result.slug).toBe("alicecd34");
  });

  test("sanitizes githubLogin: dashes and dots dropped from slug base", async () => {
    deps._state.suffixQueue = ["ef56"];
    const result = await upgradeToNewOrg(deps, {
      userId: "user-new-abcdef1234",
      githubLogin: "My.Weird-Name",
      email: "m@example.com",
    });

    // `My.Weird-Name` → `myweirdname` → + suffix `ef56` → `myweirdnameef56`.
    // Final slug MUST be alphanumeric only so the bearer verifier accepts it.
    expect(result.slug).toBe("myweirdnameef56");
    expect(result.slug).toMatch(/^[a-z0-9]+$/);
  });

  test("slug base capped at 20 chars so org names don't balloon", async () => {
    deps._state.suffixQueue = ["gh78"];
    const result = await upgradeToNewOrg(deps, {
      userId: "user-new-abcdef1234",
      githubLogin: "a".repeat(50),
      email: "x@example.com",
    });

    // 20 'a's + 4-char suffix = 24 chars total.
    expect(result.slug).toBe(`${"a".repeat(20)}gh78`);
  });

  test("empty githubLogin AND empty email local-part falls back to `user`", async () => {
    deps._state.suffixQueue = ["ij90"];
    const result = await upgradeToNewOrg(deps, {
      userId: "user-new-abcdef1234",
      githubLogin: "",
      email: "@weird.example.com",
    });

    expect(result.slug).toBe("userij90");
  });

  test("non-alphanumeric suffix is sanitized (no dashes in slug)", async () => {
    deps._state.suffixQueue = ["a-b!c"];
    const result = await upgradeToNewOrg(deps, {
      userId: "user-new-abcdef1234",
      githubLogin: "octocat",
      email: "dev@example.com",
    });

    // Dashes and punctuation stripped → `abc`.
    expect(result.slug).toBe("octocatabc");
    expect(result.slug).toMatch(/^[a-z0-9]+$/);
  });

  test("empty suffix falls back to `x` so the slug base doesn't stand alone", async () => {
    deps._state.suffixQueue = ["!!!"];
    const result = await upgradeToNewOrg(deps, {
      userId: "user-new-abcdef1234",
      githubLogin: "octocat",
      email: "dev@example.com",
    });

    expect(result.slug).toBe("octocatx");
  });
});

describe("upgradeToNewOrg — idempotency on replay", () => {
  test("calling twice on the same default-org user returns already_upgraded second time", async () => {
    const deps = makeStubs();
    deps._state.users.set("user-replay", {
      id: "user-replay",
      orgId: "org-default",
      role: "ic",
      email: "r@example.com",
    });
    deps._state.suffixQueue = ["rp01", "rp02"];

    const first = await upgradeToNewOrg(deps, {
      userId: "user-replay",
      githubLogin: "replay",
      email: "r@example.com",
    });
    const second = await upgradeToNewOrg(deps, {
      userId: "user-replay",
      githubLogin: "replay",
      email: "r@example.com",
    });

    expect(first.action).toBe("created_new_org");
    expect(second.action).toBe("already_upgraded");
    expect(second.orgId).toBe(first.orgId);
    expect(second.slug).toBe(first.slug);
    expect(deps._state.promotedUsers).toHaveLength(1);
    expect(deps._state.createdDevelopers).toHaveLength(1);
  });
});
