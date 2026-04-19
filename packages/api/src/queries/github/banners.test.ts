// G3 — squash-merge banner render test (PRD §13 Phase G3).
//
// Uses a fake in-memory ctx (no DB). Verifies:
//   (a) when a squash-only repo exists, the banner is surfaced
//   (b) when no squash-only repos exist, banner absent
//   (c) dismissal state rendered

import { describe, expect, test } from "bun:test";
import type { Ctx } from "../../auth";
import { getGithubAdminBanners } from "./banners";

const TENANT = "11111111-2222-3333-4444-555555555555";

function makeCtx(opts: {
  squashOnlyRepos?: Array<{ provider_repo_id: string }>;
  dismissed?: boolean;
}): Ctx {
  const squashOnlyRepos = opts.squashOnlyRepos ?? [];
  const dismissed = opts.dismissed ?? false;
  return {
    tenant_id: TENANT,
    actor_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    role: "admin",
    db: {
      pg: {
        async query<T = unknown>(sql: string): Promise<T[]> {
          if (
            /FROM repos/i.test(sql) &&
            /merge_commit_allowed/i.test(sql) &&
            /squash_merge_allowed/i.test(sql)
          ) {
            return squashOnlyRepos.map((r) => ({
              provider_repo_id: r.provider_repo_id,
              n: squashOnlyRepos.length,
            })) as unknown as T[];
          }
          if (/admin_dismissed_banners/i.test(sql)) {
            return dismissed
              ? ([{ dismissed_at: new Date("2026-04-17T00:00:00Z") }] as unknown as T[])
              : [];
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
}

describe("getGithubAdminBanners", () => {
  test("squash-only repo exists → banner surfaced with affected count + sample", async () => {
    const ctx = makeCtx({
      squashOnlyRepos: [{ provider_repo_id: "101" }, { provider_repo_id: "102" }],
    });
    const out = await getGithubAdminBanners(ctx, {});
    expect(out.banners).toHaveLength(1);
    const banner = out.banners[0];
    expect(banner?.banner_key).toBe("squash_merge_trailer_loss");
    expect(banner?.dismissed).toBe(false);
    expect(banner?.metadata.affected_repo_count).toBe(2);
    expect(banner?.metadata.sample_provider_repo_ids).toEqual(["101", "102"]);
  });

  test("no squash-only repos → empty banners list", async () => {
    const ctx = makeCtx({ squashOnlyRepos: [] });
    const out = await getGithubAdminBanners(ctx, {});
    expect(out.banners).toEqual([]);
  });

  test("squash-only repo + user dismissed → banner includes dismissed=true", async () => {
    const ctx = makeCtx({
      squashOnlyRepos: [{ provider_repo_id: "101" }],
      dismissed: true,
    });
    const out = await getGithubAdminBanners(ctx, {});
    expect(out.banners[0]?.dismissed).toBe(true);
    expect(out.banners[0]?.dismissed_at).toBe(new Date("2026-04-17T00:00:00Z").toISOString());
  });
});
