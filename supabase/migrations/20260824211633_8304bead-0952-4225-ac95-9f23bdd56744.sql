DROP INDEX IF EXISTS public.idx_source_postings_source_status_published;
CREATE INDEX IF NOT EXISTS idx_source_postings_match_cover
  ON public.source_postings (source, posting_status, published_at DESC)
  INCLUDE (id, title, identity_role)
  WHERE identity_superseded_by_source_posting_id IS NULL;
ANALYZE public.source_postings;