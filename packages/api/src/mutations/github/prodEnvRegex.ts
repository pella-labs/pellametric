import { AuthError, assertRole, type Ctx } from "../../auth";
import type {
  PatchRepoProdEnvRegexInput,
  PatchRepoProdEnvRegexOutput,
} from "../../schemas/github/prodEnvRegex";

/**
 * PRD-github-integration §11.7 / D60 — `PATCH /api/admin/github/repos/:provider_repo_id/prod-env-regex`.
 *
 * Writes `repos.prod_env_allowlist_regex` (nullable). NULL = use global
 * default `^(prod|production|live|main)$`. Validates the pattern compiles
 * as a RegExp before writing; invalid patterns throw AuthError("BAD_REQUEST")
 * which the route maps to HTTP 400.
 *
 * Returns a preview of environments observed in `github_deployments` in the
 * last 30 days that would match the new regex — so the admin sees what
 * they're enabling before committing.
 *
 * Admin-only. Audit-logged.
 */
export async function patchRepoProdEnvRegex(
  ctx: Ctx,
  input: PatchRepoProdEnvRegexInput,
): Promise<PatchRepoProdEnvRegexOutput> {
  assertRole(ctx, ["admin"]);

  // Validate the regex compiles. We intentionally DO NOT attempt to match
  // anything dangerous — the worst we can hit is ReDoS on a pathological
  // pattern, mitigated by the 200-char length cap in the zod schema.
  let compiled: RegExp | null = null;
  if (input.pattern !== null) {
    try {
      compiled = new RegExp(input.pattern);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new AuthError("BAD_REQUEST", `Invalid regex: ${msg}`);
    }
  }

  // Ensure repo belongs to caller's tenant.
  const existingRows = await ctx.db.pg.query<{ id: string }>(
    `SELECT id::text AS id
       FROM repos
      WHERE org_id = $1
        AND provider = 'github'
        AND provider_repo_id = $2
        AND deleted_at IS NULL
      LIMIT 1`,
    [ctx.tenant_id, input.provider_repo_id],
  );
  if (!existingRows[0]) {
    throw new AuthError(
      "FORBIDDEN",
      `Repo provider_repo_id=${input.provider_repo_id} not found in your org.`,
    );
  }

  await ctx.db.pg.query(
    `UPDATE repos
        SET prod_env_allowlist_regex = $3
      WHERE org_id = $1
        AND provider = 'github'
        AND provider_repo_id = $2`,
    [ctx.tenant_id, input.provider_repo_id, input.pattern],
  );

  // Preview last-30d environments that match (for the admin UI's
  // "matching environments" panel).
  const envRows = await ctx.db.pg.query<{ environment: string }>(
    `SELECT DISTINCT environment
       FROM github_deployments
      WHERE tenant_id = $1
        AND provider_repo_id = $2
        AND updated_at >= now() - interval '30 days'
      ORDER BY environment
      LIMIT 50`,
    [ctx.tenant_id, input.provider_repo_id],
  );
  const environments = envRows.map((r) => r.environment);
  const effectiveRegex = compiled ?? /^(prod|production|live|main)$/;
  const matching = environments.filter((e) => effectiveRegex.test(e)).slice(0, 20);

  try {
    await ctx.db.pg.query(
      `INSERT INTO audit_log
         (org_id, actor_user_id, action, target_type, target_id, metadata_json)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [
        ctx.tenant_id,
        ctx.actor_id,
        "github.prod_env_regex_updated",
        "github_repo",
        input.provider_repo_id,
        {
          pattern: input.pattern,
          sampled_environments_total: environments.length,
          matching_count: matching.length,
        },
      ],
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      JSON.stringify({
        level: "error",
        module: "api/mutations/github/prodEnvRegex",
        msg: "audit_log write failed",
        err: msg,
      }),
    );
  }

  return {
    provider_repo_id: input.provider_repo_id,
    pattern: input.pattern,
    matching_environments_sample: matching,
  };
}
