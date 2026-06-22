
-- ============================================================
-- Careerjet identity & repair schema (v5-final, A1-A6) — retry
-- ============================================================

CREATE SEQUENCE IF NOT EXISTS public.careerjet_fencing_seq;
REVOKE ALL ON SEQUENCE public.careerjet_fencing_seq FROM PUBLIC;
REVOKE ALL ON SEQUENCE public.careerjet_fencing_seq FROM anon;
REVOKE ALL ON SEQUENCE public.careerjet_fencing_seq FROM authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.careerjet_fencing_seq TO service_role;

CREATE TABLE IF NOT EXISTS public.careerjet_source_threads (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_fingerprint        text     NOT NULL,
  fp_version                  smallint NOT NULL DEFAULT 2,
  generation                  integer  NOT NULL DEFAULT 1,
  thread_key                  text     NOT NULL,
  keeper_source_posting_id    uuid     NOT NULL,
  stable_content_hash         text,
  stable_content_hash_version smallint NOT NULL DEFAULT 1,
  first_seen_run_id           uuid,
  last_seen_run_id            uuid,
  last_seen_at                timestamptz,
  state                       text     NOT NULL DEFAULT 'active'
    CHECK (state IN ('active','stale','reopened','closed','review')),
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.careerjet_source_threads TO service_role;
ALTER TABLE public.careerjet_source_threads ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.careerjet_source_threads
  ADD CONSTRAINT careerjet_threads_thread_key_uk UNIQUE (thread_key);
ALTER TABLE public.careerjet_source_threads
  ADD CONSTRAINT careerjet_threads_fp_gen_uk UNIQUE (identity_fingerprint, fp_version, generation);

CREATE UNIQUE INDEX careerjet_threads_one_active_uk
  ON public.careerjet_source_threads (identity_fingerprint, fp_version)
  WHERE state = 'active';
CREATE INDEX careerjet_threads_active_stale_fp_idx
  ON public.careerjet_source_threads (identity_fingerprint, fp_version)
  WHERE state IN ('active','stale');
CREATE INDEX careerjet_threads_last_seen_active_idx
  ON public.careerjet_source_threads (last_seen_at) WHERE state = 'active';
CREATE INDEX careerjet_threads_review_idx
  ON public.careerjet_source_threads (state) WHERE state = 'review';

CREATE TRIGGER careerjet_threads_set_updated_at
  BEFORE UPDATE ON public.careerjet_source_threads
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.source_postings
  ADD COLUMN IF NOT EXISTS identity_thread_id uuid,
  ADD COLUMN IF NOT EXISTS identity_superseded_by_source_posting_id uuid,
  ADD COLUMN IF NOT EXISTS identity_role text,
  ADD COLUMN IF NOT EXISTS identity_fp_version smallint,
  ADD COLUMN IF NOT EXISTS identity_resolved_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='source_postings_identity_role_chk') THEN
    ALTER TABLE public.source_postings ADD CONSTRAINT source_postings_identity_role_chk
      CHECK (identity_role IS NULL OR identity_role IN ('keeper','superseded','unresolved'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='source_postings_identity_thread_fk') THEN
    ALTER TABLE public.source_postings ADD CONSTRAINT source_postings_identity_thread_fk
      FOREIGN KEY (identity_thread_id) REFERENCES public.careerjet_source_threads(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='source_postings_identity_superseded_fk') THEN
    ALTER TABLE public.source_postings ADD CONSTRAINT source_postings_identity_superseded_fk
      FOREIGN KEY (identity_superseded_by_source_posting_id) REFERENCES public.source_postings(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='careerjet_threads_keeper_fk') THEN
    ALTER TABLE public.careerjet_source_threads ADD CONSTRAINT careerjet_threads_keeper_fk
      FOREIGN KEY (keeper_source_posting_id) REFERENCES public.source_postings(id) ON DELETE RESTRICT
      DEFERRABLE INITIALLY DEFERRED;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='careerjet_threads_first_run_fk') THEN
    ALTER TABLE public.careerjet_source_threads ADD CONSTRAINT careerjet_threads_first_run_fk
      FOREIGN KEY (first_seen_run_id) REFERENCES public.careerjet_sync_runs(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='careerjet_threads_last_run_fk') THEN
    ALTER TABLE public.careerjet_source_threads ADD CONSTRAINT careerjet_threads_last_run_fk
      FOREIGN KEY (last_seen_run_id) REFERENCES public.careerjet_sync_runs(id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS source_postings_identity_thread_idx
  ON public.source_postings (identity_thread_id) WHERE identity_thread_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS source_postings_identity_superseded_idx
  ON public.source_postings (identity_superseded_by_source_posting_id) WHERE identity_role='superseded';
CREATE INDEX IF NOT EXISTS source_postings_careerjet_keeper_idx
  ON public.source_postings (source, last_seen_at) WHERE source='careerjet' AND identity_role='keeper';

CREATE TABLE IF NOT EXISTS public.careerjet_source_observations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id           uuid NOT NULL REFERENCES public.careerjet_source_threads(id) ON DELETE RESTRICT,
  sync_run_id         uuid NOT NULL REFERENCES public.careerjet_sync_runs(id)      ON DELETE RESTRICT,
  observed_at         timestamptz NOT NULL DEFAULT now(),
  stable_content_hash text,
  was_changed         boolean NOT NULL,
  classification      text NOT NULL CHECK (classification IN ('first_sight','re_seen_noop','re_seen_changed')),
  alias_count         integer NOT NULL DEFAULT 0,
  term_count          integer NOT NULL DEFAULT 0,
  UNIQUE (thread_id, sync_run_id)
);
GRANT SELECT, INSERT, UPDATE ON public.careerjet_source_observations TO service_role;
ALTER TABLE public.careerjet_source_observations ENABLE ROW LEVEL SECURITY;
CREATE INDEX careerjet_observations_run_idx ON public.careerjet_source_observations (sync_run_id);

CREATE TABLE IF NOT EXISTS public.careerjet_observation_terms (
  observation_id uuid NOT NULL REFERENCES public.careerjet_source_observations(id) ON DELETE CASCADE,
  cursor_term    text NOT NULL,
  rank_in_term   integer,
  first_seen_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (observation_id, cursor_term)
);
GRANT SELECT, INSERT, UPDATE ON public.careerjet_observation_terms TO service_role;
ALTER TABLE public.careerjet_observation_terms ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.careerjet_observation_aliases (
  observation_id uuid NOT NULL REFERENCES public.careerjet_source_observations(id) ON DELETE CASCADE,
  raw_url_hash   text NOT NULL,
  raw_url_norm   text NOT NULL,
  raw_url_sample text NOT NULL,
  first_seen_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (observation_id, raw_url_hash)
);
GRANT SELECT, INSERT, UPDATE ON public.careerjet_observation_aliases TO service_role;
ALTER TABLE public.careerjet_observation_aliases ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.careerjet_writer_leases (
  lease_name    text PRIMARY KEY,
  run_id        uuid     NOT NULL,
  fencing_token bigint   NOT NULL,
  acquired_at   timestamptz NOT NULL,
  heartbeat_at  timestamptz NOT NULL,
  expires_at    timestamptz NOT NULL
);
GRANT SELECT, INSERT, UPDATE ON public.careerjet_writer_leases TO service_role;
ALTER TABLE public.careerjet_writer_leases ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.careerjet_identity_repair_runs (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at               timestamptz NOT NULL DEFAULT now(),
  finished_at              timestamptz,
  status                   text NOT NULL DEFAULT 'running'
    CHECK (status IN ('running','completed','failed','cancelled')),
  cursor_after_fingerprint text,
  total_fingerprints       integer NOT NULL DEFAULT 0,
  ids_requested            integer NOT NULL DEFAULT 0,
  ids_adopted              integer NOT NULL DEFAULT 0,
  ids_superseded           integer NOT NULL DEFAULT 0,
  ids_reviewed             integer NOT NULL DEFAULT 0,
  ids_failed               integer NOT NULL DEFAULT 0,
  ids_unprocessed          integer NOT NULL DEFAULT 0,
  meta                     jsonb   NOT NULL DEFAULT '{}'::jsonb
);
GRANT SELECT, INSERT, UPDATE ON public.careerjet_identity_repair_runs TO service_role;
ALTER TABLE public.careerjet_identity_repair_runs ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.careerjet_identity_audit (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action            text NOT NULL,
  thread_id         uuid REFERENCES public.careerjet_source_threads(id) ON DELETE RESTRICT,
  source_posting_id uuid REFERENCES public.source_postings(id)          ON DELETE RESTRICT,
  run_id            uuid REFERENCES public.careerjet_sync_runs(id)      ON DELETE RESTRICT,
  repair_run_id     uuid REFERENCES public.careerjet_identity_repair_runs(id) ON DELETE RESTRICT,
  fencing_token     bigint,
  before_jsonb      jsonb,
  after_jsonb       jsonb,
  created_at        timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.careerjet_identity_audit TO service_role;
ALTER TABLE public.careerjet_identity_audit ENABLE ROW LEVEL SECURITY;
CREATE INDEX careerjet_audit_thread_idx ON public.careerjet_identity_audit (thread_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.careerjet_identity_review (
  review_id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id            uuid REFERENCES public.careerjet_source_threads(id) ON DELETE RESTRICT,
  identity_fingerprint text,
  reason               text NOT NULL CHECK (reason IN ('missing_fingerprint','multi_cluster','volatile_metadata','manual_hold')),
  status               text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','dismissed')),
  evidence             jsonb NOT NULL DEFAULT '{}'::jsonb,
  opened_at            timestamptz NOT NULL DEFAULT now(),
  resolved_at          timestamptz,
  CHECK (thread_id IS NOT NULL OR identity_fingerprint IS NOT NULL OR reason='missing_fingerprint')
);
GRANT SELECT, INSERT, UPDATE ON public.careerjet_identity_review TO service_role;
ALTER TABLE public.careerjet_identity_review ENABLE ROW LEVEL SECURITY;
CREATE INDEX careerjet_review_open_idx ON public.careerjet_identity_review (status, reason) WHERE status='open';

CREATE TABLE IF NOT EXISTS public.careerjet_identity_review_candidates (
  review_id         uuid NOT NULL REFERENCES public.careerjet_identity_review(review_id) ON DELETE CASCADE,
  source_posting_id uuid NOT NULL REFERENCES public.source_postings(id) ON DELETE RESTRICT,
  added_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (review_id, source_posting_id)
);
GRANT SELECT, INSERT, UPDATE ON public.careerjet_identity_review_candidates TO service_role;
ALTER TABLE public.careerjet_identity_review_candidates ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.careerjet_identity_review_observations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id       uuid NOT NULL REFERENCES public.careerjet_identity_review(review_id) ON DELETE CASCADE,
  sync_run_id     uuid REFERENCES public.careerjet_sync_runs(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL,
  raw_url         text,
  raw_payload     jsonb,
  observed_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (review_id, idempotency_key)
);
GRANT SELECT, INSERT ON public.careerjet_identity_review_observations TO service_role;
ALTER TABLE public.careerjet_identity_review_observations ENABLE ROW LEVEL SECURITY;

-- ---------- Helpers ----------
CREATE OR REPLACE FUNCTION public._careerjet_thread_key(p_fp_version smallint, p_fingerprint text, p_generation integer)
 RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public, extensions, pg_temp
AS $$
  SELECT 'cj_thread_v' || p_fp_version::text || '_' ||
         encode(extensions.digest(p_fp_version::text || ':' || p_fingerprint || ':' || p_generation::text, 'sha256'), 'hex')
$$;
REVOKE ALL ON FUNCTION public._careerjet_thread_key(smallint,text,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._careerjet_thread_key(smallint,text,integer) FROM anon;
REVOKE ALL ON FUNCTION public._careerjet_thread_key(smallint,text,integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public._careerjet_thread_key(smallint,text,integer) TO service_role;

CREATE OR REPLACE FUNCTION public._careerjet_norm_text(p text)
 RETURNS text LANGUAGE sql IMMUTABLE
AS $$ SELECT NULLIF(btrim(regexp_replace(coalesce(p,''), '\s+', ' ', 'g')), ''); $$;
REVOKE ALL ON FUNCTION public._careerjet_norm_text(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._careerjet_norm_text(text) FROM anon;
REVOKE ALL ON FUNCTION public._careerjet_norm_text(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public._careerjet_norm_text(text) TO service_role;

CREATE OR REPLACE FUNCTION public._careerjet_stable_hash_v1(
  p_title text, p_company text, p_location text,
  p_description text, p_site text, p_employment jsonb
) RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public, extensions, pg_temp
AS $$
  SELECT encode(extensions.digest(
    jsonb_build_object(
      'v', 1,
      'title',       public._careerjet_norm_text(p_title),
      'company',     public._careerjet_norm_text(p_company),
      'location',    public._careerjet_norm_text(p_location),
      'description', public._careerjet_norm_text(p_description),
      'site',        public._careerjet_norm_text(p_site),
      'employment',  coalesce(p_employment,'{}'::jsonb)
    )::text, 'sha256'), 'hex');
$$;
REVOKE ALL ON FUNCTION public._careerjet_stable_hash_v1(text,text,text,text,text,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._careerjet_stable_hash_v1(text,text,text,text,text,jsonb) FROM anon;
REVOKE ALL ON FUNCTION public._careerjet_stable_hash_v1(text,text,text,text,text,jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public._careerjet_stable_hash_v1(text,text,text,text,text,jsonb) TO service_role;

-- ---------- Lease RPCs ----------
CREATE OR REPLACE FUNCTION public.careerjet_lease_claim(
  p_lease_name text, p_run_id uuid, p_ttl_seconds integer DEFAULT 180
) RETURNS TABLE(granted boolean, run_id uuid, fencing_token bigint, expires_at timestamptz, reason text)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE r public.careerjet_writer_leases%ROWTYPE; v_tok bigint;
BEGIN
  v_tok := nextval('public.careerjet_fencing_seq');
  INSERT INTO public.careerjet_writer_leases AS l (lease_name, run_id, fencing_token, acquired_at, heartbeat_at, expires_at)
  VALUES (p_lease_name, p_run_id, v_tok, now(), now(), now() + make_interval(secs => p_ttl_seconds))
  ON CONFLICT (lease_name) DO UPDATE
    SET run_id = EXCLUDED.run_id, fencing_token = EXCLUDED.fencing_token,
        acquired_at = EXCLUDED.acquired_at, heartbeat_at = EXCLUDED.heartbeat_at,
        expires_at = EXCLUDED.expires_at
    WHERE l.expires_at < now() OR l.run_id = EXCLUDED.run_id
  RETURNING * INTO r;
  IF r.run_id IS NOT NULL THEN
    RETURN QUERY SELECT true, r.run_id, r.fencing_token, r.expires_at, NULL::text;
    RETURN;
  END IF;
  SELECT * INTO r FROM public.careerjet_writer_leases WHERE lease_name = p_lease_name;
  RETURN QUERY SELECT false, r.run_id, r.fencing_token, r.expires_at, 'already_running'::text;
END $$;
REVOKE ALL ON FUNCTION public.careerjet_lease_claim(text,uuid,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.careerjet_lease_claim(text,uuid,integer) FROM anon;
REVOKE ALL ON FUNCTION public.careerjet_lease_claim(text,uuid,integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.careerjet_lease_claim(text,uuid,integer) TO service_role;

CREATE OR REPLACE FUNCTION public.careerjet_lease_heartbeat(
  p_lease_name text, p_run_id uuid, p_fencing_token bigint, p_ttl_seconds integer DEFAULT 180
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE n integer;
BEGIN
  UPDATE public.careerjet_writer_leases
     SET heartbeat_at = now(), expires_at = now() + make_interval(secs => p_ttl_seconds)
   WHERE lease_name = p_lease_name AND run_id = p_run_id AND fencing_token = p_fencing_token;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n > 0;
END $$;
REVOKE ALL ON FUNCTION public.careerjet_lease_heartbeat(text,uuid,bigint,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.careerjet_lease_heartbeat(text,uuid,bigint,integer) FROM anon;
REVOKE ALL ON FUNCTION public.careerjet_lease_heartbeat(text,uuid,bigint,integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.careerjet_lease_heartbeat(text,uuid,bigint,integer) TO service_role;

CREATE OR REPLACE FUNCTION public.careerjet_lease_release(
  p_lease_name text, p_run_id uuid, p_fencing_token bigint
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE n integer;
BEGIN
  DELETE FROM public.careerjet_writer_leases
   WHERE lease_name = p_lease_name AND run_id = p_run_id AND fencing_token = p_fencing_token;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n > 0;
END $$;
REVOKE ALL ON FUNCTION public.careerjet_lease_release(text,uuid,bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.careerjet_lease_release(text,uuid,bigint) FROM anon;
REVOKE ALL ON FUNCTION public.careerjet_lease_release(text,uuid,bigint) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.careerjet_lease_release(text,uuid,bigint) TO service_role;

CREATE OR REPLACE FUNCTION public._careerjet_assert_lease(
  p_lease_name text, p_run_id uuid, p_fencing_token bigint
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE ok boolean;
BEGIN
  SELECT EXISTS(SELECT 1 FROM public.careerjet_writer_leases
                 WHERE lease_name=p_lease_name AND run_id=p_run_id
                   AND fencing_token=p_fencing_token AND expires_at>now()) INTO ok;
  IF NOT ok THEN RAISE EXCEPTION 'lease_lost' USING ERRCODE='P0001'; END IF;
END $$;
REVOKE ALL ON FUNCTION public._careerjet_assert_lease(text,uuid,bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._careerjet_assert_lease(text,uuid,bigint) FROM anon;
REVOKE ALL ON FUNCTION public._careerjet_assert_lease(text,uuid,bigint) FROM authenticated;
GRANT EXECUTE ON FUNCTION public._careerjet_assert_lease(text,uuid,bigint) TO service_role;

-- ---------- Atomic resolver ----------
CREATE OR REPLACE FUNCTION public.careerjet_resolve_listing(
  p_run_id uuid, p_fencing_token bigint, p_fp_version smallint,
  p_identity_fingerprint text, p_source_posting_in jsonb,
  p_observation_aliases jsonb DEFAULT '[]'::jsonb,
  p_observation_terms   jsonb DEFAULT '[]'::jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
 SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_thread     public.careerjet_source_threads%ROWTYPE;
  v_keeper     public.source_postings%ROWTYPE;
  v_thread_key text; v_new_thread_id uuid; v_new_post_id uuid;
  v_mt text; v_mc text; v_ml text; v_md text; v_ms text; v_me jsonb;
  v_it text; v_ic text; v_il text; v_id text; v_is text; v_ie jsonb;
  v_hash text; v_was_changed boolean; v_classification text;
  v_obs_id uuid; v_alias_rows integer := 0; v_term_rows integer := 0;
  v_review_id uuid;
BEGIN
  PERFORM public._careerjet_assert_lease('careerjet_global', p_run_id, p_fencing_token);

  IF p_identity_fingerprint IS NULL OR length(btrim(p_identity_fingerprint))=0 THEN
    SELECT review_id INTO v_review_id FROM public.careerjet_identity_review
     WHERE reason='missing_fingerprint' AND status='open'
       AND identity_fingerprint IS NULL AND thread_id IS NULL LIMIT 1;
    IF v_review_id IS NULL THEN
      INSERT INTO public.careerjet_identity_review (reason, status, evidence)
        VALUES ('missing_fingerprint','open', jsonb_build_object('first_run_id', p_run_id))
        RETURNING review_id INTO v_review_id;
    END IF;
    INSERT INTO public.careerjet_identity_review_observations
      (review_id, sync_run_id, idempotency_key, raw_url, raw_payload)
    VALUES (v_review_id, p_run_id,
      coalesce(p_source_posting_in->>'raw_url_hash',
               encode(extensions.digest(p_run_id::text||':'||coalesce(p_source_posting_in->>'raw_url',''),'sha256'),'hex')),
      p_source_posting_in->>'raw_url', p_source_posting_in)
    ON CONFLICT (review_id, idempotency_key) DO NOTHING;
    RETURN jsonb_build_object('action','review','review_id',v_review_id,'fencing_token_valid',true);
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_fp_version::text||':'||p_identity_fingerprint, 0));

  v_thread_key := public._careerjet_thread_key(p_fp_version, p_identity_fingerprint, 1);

  SELECT * INTO v_thread FROM public.careerjet_source_threads
   WHERE identity_fingerprint=p_identity_fingerprint AND fp_version=p_fp_version AND state='active' FOR UPDATE;

  v_it := p_source_posting_in->>'title';
  v_ic := p_source_posting_in->>'company';
  v_il := p_source_posting_in->>'location';
  v_id := p_source_posting_in->>'description';
  v_is := p_source_posting_in->>'site';
  v_ie := coalesce(p_source_posting_in->'employment','{}'::jsonb);

  IF v_thread.id IS NULL THEN
    v_new_thread_id := gen_random_uuid();
    v_new_post_id   := gen_random_uuid();

    INSERT INTO public.source_postings (
      id, source, source_external_id, raw_url, display_url,
      title, company, location, description_excerpt, raw_payload,
      identity_fingerprint, published_at, posting_status, last_seen_at,
      identity_role, identity_fp_version, identity_resolved_at
    ) VALUES (
      v_new_post_id, 'careerjet', v_thread_key,
      coalesce(p_source_posting_in->>'raw_url',''),
      coalesce(p_source_posting_in->>'display_url', p_source_posting_in->>'raw_url',''),
      v_it, v_ic, v_il, v_id, p_source_posting_in, p_identity_fingerprint,
      NULLIF(p_source_posting_in->>'published_at','')::timestamptz, 'active', now(),
      'keeper', p_fp_version, now()
    );

    v_hash := public._careerjet_stable_hash_v1(v_it, v_ic, v_il, v_id, v_is, v_ie);

    INSERT INTO public.careerjet_source_threads (
      id, identity_fingerprint, fp_version, generation, thread_key,
      keeper_source_posting_id, stable_content_hash, stable_content_hash_version,
      first_seen_run_id, last_seen_run_id, last_seen_at, state
    ) VALUES (
      v_new_thread_id, p_identity_fingerprint, p_fp_version, 1, v_thread_key,
      v_new_post_id, v_hash, 1, p_run_id, p_run_id, now(), 'active'
    );

    UPDATE public.source_postings SET identity_thread_id = v_new_thread_id WHERE id = v_new_post_id;

    SELECT * INTO v_thread FROM public.careerjet_source_threads WHERE id=v_new_thread_id;
    v_was_changed := true; v_classification := 'first_sight';

    INSERT INTO public.careerjet_identity_audit
      (action, thread_id, source_posting_id, run_id, fencing_token, after_jsonb)
    VALUES ('first_sight', v_new_thread_id, v_new_post_id, p_run_id, p_fencing_token,
            jsonb_build_object('thread_key', v_thread_key, 'hash', v_hash));
  ELSE
    SELECT * INTO v_keeper FROM public.source_postings WHERE id=v_thread.keeper_source_posting_id FOR UPDATE;

    v_mt := CASE WHEN length(coalesce(v_it,'')) > length(coalesce(v_keeper.title,''))
                 THEN v_it ELSE coalesce(v_keeper.title, v_it) END;
    v_mc := CASE WHEN length(coalesce(v_ic,'')) > length(coalesce(v_keeper.company,''))
                 THEN v_ic ELSE coalesce(v_keeper.company, v_ic) END;
    v_ml := CASE WHEN length(coalesce(v_il,'')) > length(coalesce(v_keeper.location,''))
                 THEN v_il ELSE coalesce(v_keeper.location, v_il) END;
    v_md := CASE WHEN length(coalesce(v_id,'')) > length(coalesce(v_keeper.description_excerpt,''))
                 THEN v_id ELSE coalesce(v_keeper.description_excerpt, v_id) END;
    v_ms := coalesce(v_is, v_keeper.raw_payload->>'site');
    v_me := coalesce(v_ie, v_keeper.raw_payload->'employment', '{}'::jsonb);

    v_hash := public._careerjet_stable_hash_v1(v_mt, v_mc, v_ml, v_md, v_ms, v_me);
    v_was_changed := (v_hash IS DISTINCT FROM v_thread.stable_content_hash);
    v_classification := CASE WHEN v_was_changed THEN 're_seen_changed' ELSE 're_seen_noop' END;

    IF v_was_changed THEN
      UPDATE public.source_postings SET
        title=v_mt, company=v_mc, location=v_ml, description_excerpt=v_md,
        raw_payload = coalesce(raw_payload,'{}'::jsonb) ||
                      jsonb_build_object('site', v_ms, 'employment', v_me),
        last_seen_at = now(), updated_at = now()
       WHERE id = v_keeper.id;
      UPDATE public.careerjet_source_threads SET
        stable_content_hash=v_hash, last_seen_run_id=p_run_id, last_seen_at=now(), updated_at=now()
       WHERE id=v_thread.id;
      INSERT INTO public.careerjet_identity_audit
        (action, thread_id, source_posting_id, run_id, fencing_token, before_jsonb, after_jsonb)
      VALUES ('keeper_merge', v_thread.id, v_keeper.id, p_run_id, p_fencing_token,
              jsonb_build_object('hash', v_thread.stable_content_hash),
              jsonb_build_object('hash', v_hash));
    ELSE
      UPDATE public.source_postings SET last_seen_at=now() WHERE id=v_keeper.id;
      UPDATE public.careerjet_source_threads SET
        last_seen_run_id=p_run_id, last_seen_at=now(), updated_at=now()
       WHERE id=v_thread.id;
    END IF;
  END IF;

  INSERT INTO public.careerjet_source_observations
    (thread_id, sync_run_id, stable_content_hash, was_changed, classification)
  VALUES (v_thread.id, p_run_id, v_hash, v_was_changed, v_classification)
  ON CONFLICT (thread_id, sync_run_id) DO NOTHING
  RETURNING id INTO v_obs_id;

  IF v_obs_id IS NULL THEN
    SELECT id INTO v_obs_id FROM public.careerjet_source_observations
     WHERE thread_id=v_thread.id AND sync_run_id=p_run_id;
  END IF;

  IF jsonb_typeof(p_observation_aliases)='array' THEN
    WITH ins AS (
      INSERT INTO public.careerjet_observation_aliases (observation_id, raw_url_hash, raw_url_norm, raw_url_sample)
      SELECT v_obs_id, a->>'raw_url_hash', coalesce(a->>'raw_url_norm',''), coalesce(a->>'raw_url_sample','')
        FROM jsonb_array_elements(p_observation_aliases) a WHERE a->>'raw_url_hash' IS NOT NULL
      ON CONFLICT DO NOTHING RETURNING 1
    ) SELECT count(*) INTO v_alias_rows FROM ins;
  END IF;
  IF jsonb_typeof(p_observation_terms)='array' THEN
    WITH ins AS (
      INSERT INTO public.careerjet_observation_terms (observation_id, cursor_term, rank_in_term)
      SELECT v_obs_id, t->>'cursor_term', NULLIF(t->>'rank_in_term','')::integer
        FROM jsonb_array_elements(p_observation_terms) t WHERE t->>'cursor_term' IS NOT NULL
      ON CONFLICT DO NOTHING RETURNING 1
    ) SELECT count(*) INTO v_term_rows FROM ins;
  END IF;

  IF v_alias_rows>0 OR v_term_rows>0 THEN
    UPDATE public.careerjet_source_observations
       SET alias_count = alias_count + v_alias_rows, term_count = term_count + v_term_rows
     WHERE id = v_obs_id;
  END IF;

  RETURN jsonb_build_object(
    'action', v_classification, 'thread_id', v_thread.id, 'observation_id', v_obs_id,
    'keeper_source_posting_id', v_thread.keeper_source_posting_id, 'fencing_token_valid', true);
END $$;
REVOKE ALL ON FUNCTION public.careerjet_resolve_listing(uuid,bigint,smallint,text,jsonb,jsonb,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.careerjet_resolve_listing(uuid,bigint,smallint,text,jsonb,jsonb,jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.careerjet_resolve_listing(uuid,bigint,smallint,text,jsonb,jsonb,jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.careerjet_resolve_listing(uuid,bigint,smallint,text,jsonb,jsonb,jsonb) TO service_role;

-- ---------- Admin RPCs ----------
CREATE OR REPLACE FUNCTION public.careerjet_identity_status()
 RETURNS TABLE(threads_active bigint, threads_stale bigint, threads_review bigint,
               source_postings_keeper bigint, source_postings_superseded bigint,
               source_postings_unresolved bigint, review_open bigint)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'admin'::public.app_role) THEN
    RAISE EXCEPTION 'forbidden: admin required' USING ERRCODE='42501';
  END IF;
  RETURN QUERY SELECT
    (SELECT count(*) FROM public.careerjet_source_threads WHERE state='active'),
    (SELECT count(*) FROM public.careerjet_source_threads WHERE state='stale'),
    (SELECT count(*) FROM public.careerjet_source_threads WHERE state='review'),
    (SELECT count(*) FROM public.source_postings WHERE source='careerjet' AND identity_role='keeper'),
    (SELECT count(*) FROM public.source_postings WHERE source='careerjet' AND identity_role='superseded'),
    (SELECT count(*) FROM public.source_postings WHERE source='careerjet' AND identity_role='unresolved'),
    (SELECT count(*) FROM public.careerjet_identity_review WHERE status='open');
END $$;
REVOKE ALL ON FUNCTION public.careerjet_identity_status() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.careerjet_identity_status() FROM anon;
GRANT EXECUTE ON FUNCTION public.careerjet_identity_status() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.careerjet_identity_repair_progress()
 RETURNS TABLE(run_id uuid, started_at timestamptz, status text,
               cursor_after_fingerprint text, total_fingerprints integer,
               ids_requested integer, ids_adopted integer, ids_superseded integer,
               ids_reviewed integer, ids_failed integer, ids_unprocessed integer)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'admin'::public.app_role) THEN
    RAISE EXCEPTION 'forbidden: admin required' USING ERRCODE='42501';
  END IF;
  RETURN QUERY
  SELECT r.id, r.started_at, r.status, r.cursor_after_fingerprint, r.total_fingerprints,
         r.ids_requested, r.ids_adopted, r.ids_superseded, r.ids_reviewed, r.ids_failed, r.ids_unprocessed
    FROM public.careerjet_identity_repair_runs r ORDER BY r.started_at DESC LIMIT 10;
END $$;
REVOKE ALL ON FUNCTION public.careerjet_identity_repair_progress() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.careerjet_identity_repair_progress() FROM anon;
GRANT EXECUTE ON FUNCTION public.careerjet_identity_repair_progress() TO authenticated, service_role;
