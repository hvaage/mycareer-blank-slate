-- Temporary grants so the sandbox import role can load the start snapshot into reg.*.
-- Will be revoked in a follow-up migration after import + backfill + ANALYZE is verified.
GRANT USAGE ON SCHEMA reg TO sandbox_exec;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA reg TO sandbox_exec;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA reg TO sandbox_exec;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA reg TO sandbox_exec;