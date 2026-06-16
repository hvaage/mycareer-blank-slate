-- M2.2: Revoke temporary import privileges from sandbox_exec on reg.*
-- TRUNCATE/DELETE were only needed for the lean snapshot import.
-- Keep SELECT/INSERT/UPDATE for ongoing sync work; revoke destructive rights.

REVOKE TRUNCATE, DELETE ON reg.enheter FROM sandbox_exec;
REVOKE TRUNCATE, DELETE ON reg.regnskap FROM sandbox_exec;
REVOKE TRUNCATE, DELETE ON reg.regnskap_sync_status FROM sandbox_exec;
REVOKE TRUNCATE, DELETE ON reg.kommune_fylke FROM sandbox_exec;
