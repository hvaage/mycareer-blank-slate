
-- 1) Dedupe keys table
CREATE TABLE IF NOT EXISTS public.lead_dedupe_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  dedupe_key text NOT NULL,
  source text NOT NULL,
  source_priority smallint NOT NULL DEFAULT 1,
  ref_table text,
  ref_id uuid,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_lead_dedupe_keys_user_key
  ON public.lead_dedupe_keys(user_id, dedupe_key);

ALTER TABLE public.lead_dedupe_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users own dedupe keys" ON public.lead_dedupe_keys;
CREATE POLICY "users own dedupe keys"
  ON public.lead_dedupe_keys FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER trg_lead_dedupe_keys_updated_at
  BEFORE UPDATE ON public.lead_dedupe_keys
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2) Normalize helper
CREATE OR REPLACE FUNCTION public.normalize_lead_key(
  p_url text,
  p_company text,
  p_title text,
  p_location text
) RETURNS text
LANGUAGE plpgsql IMMUTABLE
SET search_path = public
AS $$
DECLARE
  u text;
BEGIN
  IF p_url IS NOT NULL AND length(trim(p_url)) > 0 THEN
    u := lower(trim(p_url));
    -- strip protocol
    u := regexp_replace(u, '^https?://', '');
    -- strip query string and fragment
    u := regexp_replace(u, '[?#].*$', '');
    -- strip trailing slash
    u := regexp_replace(u, '/+$', '');
    -- strip www.
    u := regexp_replace(u, '^www\.', '');
    RETURN 'url:' || u;
  END IF;
  RETURN 'cmp:' ||
    coalesce(lower(regexp_replace(p_company, '\s+', ' ', 'g')), '') || '|' ||
    coalesce(lower(regexp_replace(p_title,   '\s+', ' ', 'g')), '') || '|' ||
    coalesce(lower(regexp_replace(p_location,'\s+', ' ', 'g')), '');
END;
$$;

-- 3) Register lead. Returns true if caller should proceed inserting/keeping
--    the source row; false if the lead is a duplicate or tombstoned and
--    should be skipped.
CREATE OR REPLACE FUNCTION public.register_lead(
  p_user_id uuid,
  p_source text,
  p_priority smallint,
  p_dedupe_key text,
  p_ref_table text,
  p_ref_id uuid
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  existing public.lead_dedupe_keys%ROWTYPE;
BEGIN
  SELECT * INTO existing
  FROM public.lead_dedupe_keys
  WHERE user_id = p_user_id AND dedupe_key = p_dedupe_key
  LIMIT 1;

  IF NOT FOUND THEN
    INSERT INTO public.lead_dedupe_keys(user_id, dedupe_key, source, source_priority, ref_table, ref_id, status)
    VALUES (p_user_id, p_dedupe_key, p_source, p_priority, p_ref_table, p_ref_id, 'active');
    RETURN true;
  END IF;

  -- Tombstoned -> never re-import
  IF existing.status IN ('dismissed','deleted','promoted') THEN
    RETURN false;
  END IF;

  -- Active duplicate. If new source has higher priority, take ownership.
  IF p_priority > existing.source_priority THEN
    UPDATE public.lead_dedupe_keys
       SET source = p_source, source_priority = p_priority,
           ref_table = p_ref_table, ref_id = p_ref_id,
           updated_at = now()
     WHERE id = existing.id;
    RETURN true;
  END IF;

  -- Same/lower priority and already active -> skip
  RETURN false;
END;
$$;

-- 4) Prune stale leads for a user (older than 30 days, not promoted/saved)
CREATE OR REPLACE FUNCTION public.prune_stale_leads(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.job_leads
   WHERE user_id = p_user_id
     AND promoted_application_id IS NULL
     AND status IN ('ny','avvist','arkivert')
     AND created_at < now() - interval '30 days';

  DELETE FROM public.user_job_listing_status
   WHERE user_id = p_user_id
     AND status IN ('new','dismissed')
     AND updated_at < now() - interval '30 days';

  DELETE FROM public.lead_dedupe_keys
   WHERE user_id = p_user_id
     AND status = 'active'
     AND updated_at < now() - interval '30 days'
     AND NOT EXISTS (
       SELECT 1 FROM public.job_leads jl
        WHERE jl.user_id = p_user_id
          AND lead_dedupe_keys.ref_table = 'job_leads'
          AND jl.id = lead_dedupe_keys.ref_id
     )
     AND NOT EXISTS (
       SELECT 1 FROM public.user_job_listing_status us
        WHERE us.user_id = p_user_id
          AND lead_dedupe_keys.ref_table = 'user_job_listing_status'
          AND us.id = lead_dedupe_keys.ref_id
     )
     AND NOT EXISTS (
       SELECT 1 FROM public.applications a
        WHERE a.user_id = p_user_id
          AND lead_dedupe_keys.ref_table = 'applications'
          AND a.id = lead_dedupe_keys.ref_id
     );
END;
$$;
