# Privacy adversarial gate (M2 MERGE BLOCKER)

This directory is the assembled privacy gate behind `bun run test:privacy`.
Five thresholds, each enforced by a hard test assertion (not a log line):

| Gate | Threshold | Source of truth | Test file |
|---|---|---|---|
| 1. Server-side redaction recall | ≥ 98% | `@bematist/redact` orchestrator + 100-secret corpus in `packages/fixtures/redaction/` | `gate-1-redaction-recall.test.ts` |
| 2. Clio verifier recall | ≥ 95% | `@bematist/clio` `builtinVerifier` + 50-prompt identifying corpus | `gate-2-clio-verifier-recall.test.ts` |
| 3. Forbidden-field rejection | 100% on Tier A/B | `apps/ingest/src/tier/enforceTier` + `FORBIDDEN_FIELDS` (12 fields) | `gate-3-forbidden-field-rejection.test.ts` |
| 4. Nightly invariant scan | 0 raw secrets / 0 forbidden field leaks in CH `events` rows | `containsForbiddenField` + redaction marker regex over recently-inserted rows | `gate-4-nightly-invariant-scan.test.ts` |
| 5. RLS cross-tenant probe (INT9) | 0 cross-tenant rows on every RLS-protected table | `app_bematist` role + `app.current_org_id` | `gate-5-rls-cross-tenant-probe.test.ts` |

Each gate exits the test runner with a non-zero status on regression. The
`bun run test:privacy` script wraps `bun test tests/privacy/adversarial`.

CI workflow: `.github/workflows/privacy.yml` runs this gate on any change to
`packages/redact/**`, `packages/clio/**`, `packages/schema/**`,
`apps/ingest/src/**`, and on every push to `main`.

## Sabotage check (run locally)

To prove the gate fails on regressions, comment out a redaction rule in
`packages/redact/src/engines/trufflehog.ts` (e.g. the AWS access key rule)
and re-run:

```
bun run test:privacy
```

You should see `gate-1-redaction-recall.test.ts` fail with a `recall …
< 98%` assertion message and CI exit code `1`.

## What this suite does NOT do

- It does not modify the upstream rule sets, verifier prompts, schema, RLS
  policies, or detector math. It only runs them and asserts the threshold.
- It does not require live ClickHouse or Postgres for gates 1–3. Gates 4–5
  detect their dependencies at runtime and skip with a structured warning if
  the service is missing — CI provides both via the `ci` job services so the
  privacy workflow runs them as merge-blocking.

## Owner / scope

Per `dev-docs/m2-gate-agent-team.md` §A16. Owns: `tests/privacy/adversarial/**`,
`.github/workflows/privacy.yml`, root `package.json` `test:privacy` script.
Does NOT modify `packages/redact/**`, `packages/clio/**`, detector math, or
the config signer.
