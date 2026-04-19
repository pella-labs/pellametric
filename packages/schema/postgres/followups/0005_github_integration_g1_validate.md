# Follow-up migration: VALIDATE CONSTRAINT repos_github_provider_id_required

This file documents the post-backfill validation step for the
`repos_github_provider_id_required` CHECK constraint added in
`custom/0004_github_integration_g1.sql`.

## When to run

**After** the G1 backfill worker (`apps/worker/src/github-backfill/`) has
populated every applicable `repos.provider_repo_id` in production. For v1
that pipeline is: G1-linker's initial-installation-sync → webhook writers →
re-running the backfill worker until `repos WHERE provider='github' AND
provider_repo_id IS NULL` returns 0 rows.

**Never** run this migration before that scan completes. `VALIDATE
CONSTRAINT` takes a full table scan with `SHARE UPDATE EXCLUSIVE` — safe for
reads + writes, but if any row violates the constraint the migration fails
mid-scan and the constraint remains NOT VALID. Better to prove zero-row
population first.

## SQL

Intentionally NOT shipped as a `custom/*.sql` file — the migrate.ts custom
loader applies every file in sorted order on every migrate. Keeping this
out of that folder means the validation runs only when an operator
explicitly invokes it (or a future numbered `custom/0005_*.sql` ships it
under controlled rollout).

```sql
-- Run when all legacy provider='github' rows have non-null provider_repo_id.
-- Validates the existing rows; new-row check is already enforced since the
-- NOT VALID constraint landed in 0004.
ALTER TABLE repos VALIDATE CONSTRAINT repos_github_provider_id_required;
```

## Rollback

Validation only flips `pg_constraint.convalidated` to true — there's no
state change that needs reversal. If validation fails, the constraint stays
NOT VALID (no-op for post-creation inserts, same as before).

## Test

The `github_g1_migration.test.ts` test asserts `convalidated=false` before
this migration runs. Once validation ships, that expectation flips to
`convalidated=true` (or a dedicated `github_g1_validate.test.ts` covers
the post-validation state — leave that to the G1 wrap-up PR).
