GRANT TRUNCATE, DELETE ON ALL TABLES IN SCHEMA reg TO sandbox_exec;
ALTER DEFAULT PRIVILEGES IN SCHEMA reg GRANT TRUNCATE, DELETE ON TABLES TO sandbox_exec;
TRUNCATE reg.kommune_fylke, reg.enheter, reg.regnskap, reg.regnskap_sync_status RESTART IDENTITY;