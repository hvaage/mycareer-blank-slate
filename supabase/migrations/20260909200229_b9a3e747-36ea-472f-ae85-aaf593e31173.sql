CREATE INDEX IF NOT EXISTS idx_source_postings_title_trgm
  ON public.source_postings USING gin (lower(coalesce(title, '')) gin_trgm_ops)
  WHERE posting_status = 'active';

ALTER FUNCTION public.match_user_opportunities_from_mirror(text[], integer, integer)
  SET statement_timeout = '25s';