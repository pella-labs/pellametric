-- Contract 09 invariant 6: audit_log is append-only; NEVER UPDATE, NEVER DELETE.
-- Belt-and-suspenders enforcement at the DB level via BEFORE trigger that raises.
-- App code must not bypass; PG app role runs without BYPASSRLS / SUPERUSER.

CREATE OR REPLACE FUNCTION audit_log_prevent_mutate()
  RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only — UPDATE/DELETE forbidden (contract 09 invariant 6)';
END $$;

DROP TRIGGER IF EXISTS audit_log_no_mutate_trg ON audit_log;
CREATE TRIGGER audit_log_no_mutate_trg
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_prevent_mutate();
