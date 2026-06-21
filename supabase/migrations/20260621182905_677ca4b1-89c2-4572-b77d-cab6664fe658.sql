
INSERT INTO public.nav_repair_runs (status, cursor_after_external_id, total_target_rows, meta)
VALUES ('running', '0a2f6351-cc26-4851-afd6-4655576eb58e', 0, jsonb_build_object('purpose','canary','batch_size',1))
RETURNING id, status, cursor_after_external_id;
