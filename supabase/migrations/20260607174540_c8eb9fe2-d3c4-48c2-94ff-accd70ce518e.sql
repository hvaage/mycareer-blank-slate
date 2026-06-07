
-- ============ ENUMS ============
DO $$ BEGIN
  CREATE TYPE public.survey_question_type AS ENUM ('single_choice','multi_choice','scale','open_text');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.survey_visibility AS ENUM ('hidden','full_only','public');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============ TABLES ============
CREATE TABLE IF NOT EXISTS public.survey_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL,
  title text NOT NULL,
  version_number integer NOT NULL DEFAULT 1,
  is_active boolean NOT NULL DEFAULT false,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (slug, version_number)
);

CREATE TABLE IF NOT EXISTS public.survey_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id uuid NOT NULL REFERENCES public.survey_versions(id) ON DELETE CASCADE,
  category text,
  question_text text NOT NULL,
  helper_text text,
  question_type public.survey_question_type NOT NULL,
  options jsonb NOT NULL DEFAULT '[]'::jsonb,
  scale_min integer,
  scale_max integer,
  scale_min_label text,
  scale_mid_label text,
  scale_max_label text,
  max_choices integer,
  is_required boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  is_public_result_enabled boolean NOT NULL DEFAULT false,
  is_full_result_enabled boolean NOT NULL DEFAULT true,
  visibility_level public.survey_visibility NOT NULL DEFAULT 'full_only',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_survey_questions_version ON public.survey_questions(version_id, sort_order);

CREATE TABLE IF NOT EXISTS public.survey_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id uuid NOT NULL REFERENCES public.survey_versions(id) ON DELETE CASCADE,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  submission_hash text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_survey_responses_version ON public.survey_responses(version_id);
CREATE INDEX IF NOT EXISTS idx_survey_responses_hash ON public.survey_responses(submission_hash);

CREATE TABLE IF NOT EXISTS public.respondent_profile (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  response_id uuid NOT NULL UNIQUE REFERENCES public.survey_responses(id) ON DELETE CASCADE,
  respondent_type text NOT NULL,
  industries text[] NOT NULL DEFAULT '{}',
  seniority_levels text[] NOT NULL DEFAULT '{}',
  years_experience text,
  candidate_focus text,
  sector text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.survey_answers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  response_id uuid NOT NULL REFERENCES public.survey_responses(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES public.survey_questions(id) ON DELETE CASCADE,
  answer_value jsonb NOT NULL,
  text_answer text,
  is_public_quote_approved boolean NOT NULL DEFAULT false,
  is_full_quote_approved boolean NOT NULL DEFAULT false,
  admin_note text,
  is_flagged boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (response_id, question_id)
);
CREATE INDEX IF NOT EXISTS idx_survey_answers_question ON public.survey_answers(question_id);

-- Contact info – fully decoupled from responses
CREATE TABLE IF NOT EXISTS public.result_access_signups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id uuid REFERENCES public.survey_versions(id) ON DELETE SET NULL,
  name text,
  email text NOT NULL,
  access_token text UNIQUE,
  access_granted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_result_access_email ON public.result_access_signups(email);
CREATE INDEX IF NOT EXISTS idx_result_access_token ON public.result_access_signups(access_token);

CREATE TABLE IF NOT EXISTS public.result_sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id uuid REFERENCES public.survey_versions(id) ON DELETE CASCADE,
  key text NOT NULL,
  title text NOT NULL,
  description text,
  sort_order integer NOT NULL DEFAULT 0,
  visibility_level public.survey_visibility NOT NULL DEFAULT 'full_only',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ============ GRANTS ============
GRANT SELECT ON public.survey_versions TO anon, authenticated;
GRANT ALL ON public.survey_versions TO service_role;

GRANT SELECT ON public.survey_questions TO anon, authenticated;
GRANT ALL ON public.survey_questions TO service_role;

GRANT INSERT ON public.survey_responses TO anon, authenticated;
GRANT ALL ON public.survey_responses TO service_role;

GRANT INSERT ON public.respondent_profile TO anon, authenticated;
GRANT ALL ON public.respondent_profile TO service_role;

GRANT INSERT ON public.survey_answers TO anon, authenticated;
GRANT ALL ON public.survey_answers TO service_role;

GRANT INSERT ON public.result_access_signups TO anon, authenticated;
GRANT ALL ON public.result_access_signups TO service_role;

GRANT SELECT ON public.result_sections TO anon, authenticated;
GRANT ALL ON public.result_sections TO service_role;

-- ============ RLS ============
ALTER TABLE public.survey_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.survey_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.survey_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.respondent_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.survey_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.result_access_signups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.result_sections ENABLE ROW LEVEL SECURITY;

-- Public can read active versions
CREATE POLICY "Anyone can view active survey versions"
  ON public.survey_versions FOR SELECT
  USING (is_active = true OR public.has_role(auth.uid(), 'admin'));

-- Public can read active questions on active version
CREATE POLICY "Anyone can view active questions"
  ON public.survey_questions FOR SELECT
  USING (is_active = true OR public.has_role(auth.uid(), 'admin'));

-- Anyone may submit a response (anonymous)
CREATE POLICY "Anyone can insert response"
  ON public.survey_responses FOR INSERT WITH CHECK (true);

CREATE POLICY "Anyone can insert respondent profile"
  ON public.respondent_profile FOR INSERT WITH CHECK (true);

CREATE POLICY "Anyone can insert answers"
  ON public.survey_answers FOR INSERT WITH CHECK (true);

CREATE POLICY "Anyone can insert access signup"
  ON public.result_access_signups FOR INSERT WITH CHECK (true);

-- No anon SELECT on responses/answers/profile/signups – reads go through server fns
-- Admin (via has_role) can read everything for management UI
CREATE POLICY "Admin can read responses"
  ON public.survey_responses FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admin can read respondent profile"
  ON public.respondent_profile FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admin can read answers"
  ON public.survey_answers FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admin can update answers"
  ON public.survey_answers FOR UPDATE
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admin can read signups"
  ON public.result_access_signups FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admin can update signups"
  ON public.result_access_signups FOR UPDATE
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Admin manage versions/questions/sections
CREATE POLICY "Admin manage versions"
  ON public.survey_versions FOR ALL
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admin manage questions"
  ON public.survey_questions FOR ALL
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Anyone can read sections"
  ON public.result_sections FOR SELECT USING (true);

CREATE POLICY "Admin manage sections"
  ON public.result_sections FOR ALL
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ============ TRIGGERS ============
CREATE TRIGGER trg_survey_versions_updated
  BEFORE UPDATE ON public.survey_versions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_survey_questions_updated
  BEFORE UPDATE ON public.survey_questions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ SEED VERSION 1 + QUESTIONS ============
DO $$
DECLARE v_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.survey_versions WHERE slug = 'rekrutterer' AND version_number = 1) THEN
    INSERT INTO public.survey_versions (slug, title, version_number, is_active, notes)
    VALUES ('rekrutterer', 'Rekruttererundersøkelsen 2026', 1, true, 'Første versjon')
    RETURNING id INTO v_id;

    INSERT INTO public.survey_questions
      (version_id, category, question_text, question_type, options, max_choices, is_required, sort_order, is_public_result_enabled, visibility_level)
    VALUES
    (v_id,'Vurdering','Hva er den vanligste årsaken til at en kandidat ikke går videre etter første vurdering?','single_choice',
      '["Mangler relevant erfaring","Mangler dokumenterte resultater","Utydelig CV","Svak LinkedIn-profil","Manglende ledererfaring","Manglende bransjeerfaring","Lav motivasjon","Dårlig kulturell match","Lønnsforventning","Annet"]'::jsonb,
      NULL,true,1,true,'public'),
    (v_id,'Vurdering','Hvilke tre elementer vurderer du først når du åpner en kandidatprofil?','multi_choice',
      '["Nåværende stilling","Tidligere arbeidsgivere","Resultater og prestasjoner","Utdanning","Ledererfaring","Bransjeerfaring","LinkedIn-aktivitet","Nettverk og referanser","Kompetanse og sertifiseringer","Geografisk plassering"]'::jsonb,
      3,true,2,true,'public'),
    (v_id,'Sourcing','Hvor ofte finner du kandidater gjennom aktiv Search kontra innkomne søknader?','single_choice',
      '["Nesten alltid gjennom Search","Oftest gjennom Search","Omtrent likt","Oftest gjennom søknader","Nesten alltid gjennom søknader"]'::jsonb,
      NULL,true,3,true,'public'),
    (v_id,'Sourcing','Hva kjennetegner kandidatene du oftest kontakter direkte?','multi_choice',
      '["Dokumenterte resultater","Sterk LinkedIn-profil","Relevant bransjebakgrunn","Tydelig karriereutvikling","Ledererfaring","Nisjekompetanse","Personlig merkevare","Faglig synlighet","Sterkt nettverk","Annet"]'::jsonb,
      3,true,4,false,'full_only'),
    (v_id,'Vurdering','Hvor viktig er LinkedIn sammenlignet med CV i den innledende vurderingen?','scale',
      '[]'::jsonb,NULL,true,5,true,'public'),
    (v_id,'Vurdering','Hvilken informasjon savner du oftest når du vurderer kandidater?','multi_choice',
      '["Konkret resultatoppnåelse","Personalansvar","Budsjettansvar","Endringsledelse","Motivasjon","Karriereambisjoner","Verdier","Teknologikompetanse","Språk","Annet"]'::jsonb,
      3,true,6,false,'full_only'),
    (v_id,'Marked','Hvor ofte opplever du at kandidater overvurderer sin egen attraktivitet i markedet?','single_choice',
      '["Svært ofte","Ofte","Av og til","Sjelden","Nesten aldri"]'::jsonb,NULL,true,7,true,'public'),
    (v_id,'Beslutning','Hva er den viktigste årsaken til at en kandidat takker nei til en rolle?','single_choice',
      '["Lønn","Leder","Kultur","Karriereutvikling","Lokasjon","Arbeidsform","Manglende interesse","Mottilbud","Annet"]'::jsonb,
      NULL,true,8,false,'full_only'),
    (v_id,'Marked','Hvilket utsagn stemmer best?','single_choice',
      '["De fleste kandidater forstår godt hvordan de vurderes","Mange kandidater misforstår hvordan de vurderes","De fleste kandidater misforstår hvordan de vurderes"]'::jsonb,
      NULL,true,9,true,'public'),
    (v_id,'Råd','Hvis du kunne gitt alle kandidater ett råd før de søker jobb, hva ville det vært?','open_text',
      '[]'::jsonb,NULL,false,10,false,'full_only'),
    (v_id,'Prosess','Omtrent hvor lang tid bruker du normalt på første screening av en CV eller kandidatprofil?','single_choice',
      '["Under 15 sekunder","15–30 sekunder","30–60 sekunder","1–3 minutter","Mer enn 3 minutter","Varierer for mye til å svare"]'::jsonb,
      NULL,true,11,true,'public'),
    (v_id,'AI','Hvilke AI-verktøy eller automatiserte løsninger bruker du i rekrutteringsarbeidet i dag?','multi_choice',
      '["Ingen","LinkedIn Recruiter / Talent Insights","ATS med AI-funksjoner","ChatGPT eller tilsvarende","CV-screeningverktøy","Kandidatmatching","Automatisert sourcing","Automatisert kommunikasjon","Analyse av stillingsannonser","Annet"]'::jsonb,
      NULL,true,12,true,'public'),
    (v_id,'Vurdering','Hvilke feil gjør kandidater oftest i rekrutteringsprosesser?','multi_choice',
      '["For generisk CV","For lite dokumenterte resultater","Svak forberedelse til intervju","Utydelig motivasjon","For lite forståelse av arbeidsgiver","Urealistiske lønnsforventninger","Dårlig oppfølging","Svak LinkedIn-profil","For bred og lite spisset profil","Annet"]'::jsonb,
      3,true,13,true,'public'),
    (v_id,'AI','Hvordan har AI endret hva du ser etter hos kandidater?','single_choice',
      '["AI har foreløpig liten betydning","Jeg ser mer etter digital forståelse","Jeg ser mer etter evne til å bruke AI praktisk","Jeg ser mer etter læringsevne og omstillingsevne","Jeg ser mer etter kritisk tenkning","Jeg ser mer etter dokumenterte resultater, fordi CV-er og søknader er lettere å forbedre med AI","Annet"]'::jsonb,
      NULL,true,14,true,'public'),
    (v_id,'AI','Hvor tydelig ser du at kandidater bruker AI i søknader, CV-er eller LinkedIn-profiler?','single_choice',
      '["Svært tydelig og ofte negativt","Tydelig, men ikke nødvendigvis negativt","Av og til","Sjelden","Vanskelig å vurdere"]'::jsonb,
      NULL,true,15,true,'public'),
    (v_id,'Fremtid','Hvilke kandidatferdigheter tror du blir viktigere de neste 12–24 månedene?','multi_choice',
      '["AI-kompetanse","Kommersiell forståelse","Endringsledelse","Teknologiforståelse","Kommunikasjon","Analyse og databruk","Evne til å lære raskt","Relasjonsbygging","Strategisk forståelse","Praktisk gjennomføringsevne"]'::jsonb,
      3,true,16,true,'public'),
    (v_id,'Innsikt','Hva misforstår kandidater oftest om hvordan de blir vurdert?','open_text',
      '[]'::jsonb,NULL,false,17,false,'full_only'),
    (v_id,'Innsikt','Hva kjennetegner kandidater som imponerer deg?','open_text',
      '[]'::jsonb,NULL,false,18,false,'full_only'),
    (v_id,'Råd','Hva burde kandidater gjøre mer av for å øke sjansen for å bli kontaktet eller valgt?','open_text',
      '[]'::jsonb,NULL,false,19,false,'full_only');

    UPDATE public.survey_questions
       SET scale_min=1, scale_max=10,
           scale_min_label='CV er klart viktigst',
           scale_mid_label='Like viktig',
           scale_max_label='LinkedIn er klart viktigst'
     WHERE version_id = v_id AND question_type = 'scale';
  END IF;
END $$;
