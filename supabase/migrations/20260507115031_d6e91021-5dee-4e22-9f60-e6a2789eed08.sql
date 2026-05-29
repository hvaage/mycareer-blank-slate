ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS cv_no_word_path text,
  ADD COLUMN IF NOT EXISTS cv_no_pdf_path text,
  ADD COLUMN IF NOT EXISTS cv_no_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS cv_en_word_path text,
  ADD COLUMN IF NOT EXISTS cv_en_pdf_path text,
  ADD COLUMN IF NOT EXISTS cv_en_updated_at timestamptz;