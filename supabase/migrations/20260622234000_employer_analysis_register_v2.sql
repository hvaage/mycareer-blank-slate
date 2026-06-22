-- Employer analysis v2: connect authenticated company analysis to the local
-- Bronnoysund/register mirror and persist the 8-dimension + 5-AI contract.

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS employer_analysis_v2 jsonb,
  ADD COLUMN IF NOT EXISTS employer_analysis_version integer,
  ADD COLUMN IF NOT EXISTS employer_analysis_rated_at timestamptz,
  ADD COLUMN IF NOT EXISTS employer_analysis_source_updated_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.companies'::regclass
      AND conname = 'companies_employer_analysis_v2_object_chk'
  ) THEN
    ALTER TABLE public.companies
      ADD CONSTRAINT companies_employer_analysis_v2_object_chk
      CHECK (
        employer_analysis_v2 IS NULL
        OR jsonb_typeof(employer_analysis_v2) = 'object'
      );
  END IF;
END $$;

COMMENT ON COLUMN public.companies.employer_analysis_v2 IS
  'Employer analysis schema v2: 8 employer dimensions, 5 AI-maturity signals, neutralized user-facing narratives, source metadata and register provenance.';
COMMENT ON COLUMN public.companies.employer_analysis_version IS
  'Schema version for employer_analysis_v2. Version 2 is defined by migration 20260622234000.';
COMMENT ON COLUMN public.companies.employer_analysis_rated_at IS
  'When employer_analysis_v2 was generated.';
COMMENT ON COLUMN public.companies.employer_analysis_source_updated_at IS
  'Newest local Bronnoysund/register source timestamp used by employer_analysis_v2.';

CREATE OR REPLACE FUNCTION public.get_employer_analysis_context(
  p_organisasjonsnummer text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, reg, pg_temp
AS $$
DECLARE
  v_orgnr text := regexp_replace(coalesce(p_organisasjonsnummer, ''), '\D', '', 'g');
  v_result jsonb;
BEGIN
  IF v_orgnr !~ '^[0-9]{9}$' THEN
    RAISE EXCEPTION 'invalid_organisasjonsnummer'
      USING ERRCODE = '22023';
  END IF;

  SELECT jsonb_strip_nulls(jsonb_build_object(
    'schema_version', 1,
    'source', 'brreg_local_mirror',
    'organisasjonsnummer', e.organisasjonsnummer,
    'source_updated_at', greatest(
      e.oppdatert_tidspunkt,
      e.hentet_tidspunkt,
      rs.last_success_at,
      fh.latest_fetched_at
    ),
    'entity', jsonb_strip_nulls(jsonb_build_object(
      'legal_name', e.navn,
      'organisation_form_code', e.organisasjonsform_kode,
      'organisation_form', e.organisasjonsform_beskrivelse,
      'industry_code_primary', e.naeringskode1_kode,
      'industry_primary', e.naeringskode1_beskrivelse,
      'industry_code_secondary', e.naeringskode2_kode,
      'industry_secondary', e.naeringskode2_beskrivelse,
      'activity', e.aktivitet,
      'employee_count', e.antall_ansatte,
      'has_registered_employee_count', e.har_registrert_antall_ansatte,
      'municipality', e.forretningsadresse_kommune,
      'municipality_number', e.forretningsadresse_kommunenummer,
      'county', e.forretningsadresse_fylke,
      'county_number', e.forretningsadresse_fylkesnummer,
      'postal_code', e.forretningsadresse_postnummer,
      'postal_place', e.forretningsadresse_poststed,
      'website', e.hjemmeside,
      'institutional_sector_code', e.institusjonell_sektorkode,
      'founded_at', e.stiftelsesdato,
      'registered_at', e.registreringsdato_enhetsregisteret,
      'registered_in_business_register', e.registrert_i_foretaksregisteret,
      'registered_for_vat', e.registrert_i_mvaregisteret,
      'is_group_member', e.er_i_konsern,
      'parent_organisation_number', e.overordnet_enhet,
      'is_public', e.er_offentlig,
      'bankrupt', e.konkurs,
      'in_liquidation', e.under_avvikling,
      'under_compulsory_liquidation', e.under_tvangsavvikling_eller_tvangsopplosning,
      'deleted', e.slettet,
      'statutory_purpose', e.vedtektsfestet_formaal
    )),
    'financial_history', coalesce(fh.rows, '[]'::jsonb),
    'sync', jsonb_strip_nulls(jsonb_build_object(
      'status', rs.status,
      'last_checked_at', rs.last_checked_at,
      'last_success_at', rs.last_success_at,
      'latest_financial_year', rs.latest_regnskapsaar,
      'available_pdf_years', rs.available_pdf_years
    )),
    'risk_flags', array_remove(ARRAY[
      CASE WHEN e.konkurs THEN 'bankrupt'::text END,
      CASE WHEN e.under_avvikling THEN 'in_liquidation'::text END,
      CASE WHEN e.under_tvangsavvikling_eller_tvangsopplosning THEN 'compulsory_liquidation'::text END,
      CASE WHEN e.slettet THEN 'deleted'::text END,
      CASE WHEN fh.latest_annual_result < 0 THEN 'negative_annual_result'::text END,
      CASE WHEN fh.latest_operating_result < 0 THEN 'negative_operating_result'::text END,
      CASE WHEN fh.latest_equity < 0 THEN 'negative_equity'::text END
    ], NULL),
    'data_quality_flags', array_remove(ARRAY[
      CASE WHEN coalesce(jsonb_array_length(fh.rows), 0) = 0 THEN 'missing_financials'::text END,
      CASE WHEN e.antall_ansatte IS NULL THEN 'missing_employee_count'::text END,
      CASE WHEN e.naeringskode1_kode IS NULL THEN 'missing_industry_code'::text END,
      CASE WHEN e.forretningsadresse_kommunenummer IS NULL THEN 'missing_municipality'::text END
    ], NULL)
  ))
  INTO v_result
  FROM reg.enheter e
  LEFT JOIN reg.regnskap_sync_status rs
    ON rs.organisasjonsnummer = e.organisasjonsnummer
  LEFT JOIN LATERAL (
    SELECT
      coalesce(jsonb_agg(x.payload ORDER BY x.regnskapsaar DESC, x.priority, x.hentet_tidspunkt DESC), '[]'::jsonb) AS rows,
      max(x.hentet_tidspunkt) AS latest_fetched_at,
      (array_agg(x.aarsresultat ORDER BY x.regnskapsaar DESC, x.priority, x.hentet_tidspunkt DESC))[1] AS latest_annual_result,
      (array_agg(x.driftsresultat ORDER BY x.regnskapsaar DESC, x.priority, x.hentet_tidspunkt DESC))[1] AS latest_operating_result,
      (array_agg(x.sum_egenkapital ORDER BY x.regnskapsaar DESC, x.priority, x.hentet_tidspunkt DESC))[1] AS latest_equity
    FROM (
      SELECT DISTINCT ON (r.regnskapsaar)
        r.regnskapsaar,
        r.regnskapstype,
        CASE WHEN r.regnskapstype = 'SELSKAP' THEN 0 ELSE 1 END AS priority,
        r.hentet_tidspunkt,
        r.aarsresultat,
        r.driftsresultat,
        r.sum_egenkapital,
        jsonb_strip_nulls(jsonb_build_object(
          'year', r.regnskapsaar,
          'type', r.regnskapstype,
          'period_from', r.regnskapsperiode_fra,
          'period_to', r.regnskapsperiode_til,
          'currency', r.valuta,
          'revenue', r.driftsinntekter,
          'operating_result', r.driftsresultat,
          'annual_result', r.aarsresultat,
          'equity', r.sum_egenkapital,
          'debt', r.sum_gjeld,
          'assets', r.sum_eiendeler,
          'current_assets', r.sum_omloepsmidler,
          'fixed_assets', r.sum_anleggsmidler,
          'operating_costs', r.sum_driftskostnad,
          'operating_margin_percent', CASE
            WHEN r.driftsinntekter IS NOT NULL AND r.driftsinntekter <> 0
              THEN round((r.driftsresultat / r.driftsinntekter) * 100, 2)
          END,
          'annual_result_margin_percent', CASE
            WHEN r.driftsinntekter IS NOT NULL AND r.driftsinntekter <> 0
              THEN round((r.aarsresultat / r.driftsinntekter) * 100, 2)
          END,
          'equity_ratio_percent', CASE
            WHEN r.sum_eiendeler IS NOT NULL AND r.sum_eiendeler <> 0
              THEN round((r.sum_egenkapital / r.sum_eiendeler) * 100, 2)
          END,
          'debt_to_equity', CASE
            WHEN r.sum_egenkapital IS NOT NULL AND r.sum_egenkapital <> 0
              THEN round(r.sum_gjeld / r.sum_egenkapital, 2)
          END,
          'liquidation_accounts', r.avviklingsregnskap,
          'small_company', r.smaa_foretak,
          'unaudited_accounts', r.ikke_revidert_aarsregnskap,
          'audit_waived', r.fravalg_revisjon,
          'fetched_at', r.hentet_tidspunkt
        )) AS payload
      FROM reg.regnskap r
      WHERE r.organisasjonsnummer = e.organisasjonsnummer
      ORDER BY r.regnskapsaar DESC NULLS LAST,
        CASE WHEN r.regnskapstype = 'SELSKAP' THEN 0 ELSE 1 END,
        r.hentet_tidspunkt DESC NULLS LAST
      LIMIT 3
    ) x
  ) fh ON true
  WHERE e.organisasjonsnummer = v_orgnr
    AND coalesce(e.slettet, false) = false;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_employer_analysis_context(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_employer_analysis_context(text)
  TO service_role;

COMMENT ON FUNCTION public.get_employer_analysis_context(text) IS
  'Service-role-only structured Bronnoysund entity and three-year financial context for employer analysis. Returns no raw payload or contact details.';

CREATE OR REPLACE FUNCTION public.ensure_company_for_employer(
  p_organisasjonsnummer text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, reg, pg_temp
AS $$
DECLARE
  v_orgnr text := regexp_replace(coalesce(p_organisasjonsnummer, ''), '\D', '', 'g');
  v_id uuid;
BEGIN
  IF v_orgnr !~ '^[0-9]{9}$' THEN
    RAISE EXCEPTION 'invalid_organisasjonsnummer'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM reg.enheter e
    WHERE e.organisasjonsnummer = v_orgnr
      AND coalesce(e.slettet, false) = false
  ) THEN
    RAISE EXCEPTION 'employer_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.companies (
    name,
    organisasjonsnummer,
    domain,
    country,
    industry,
    description,
    size_estimate,
    ownership_type,
    brreg_matched_at,
    brreg_match_source,
    brreg_match_confidence
  )
  SELECT
    e.navn,
    e.organisasjonsnummer,
    nullif(regexp_replace(coalesce(e.hjemmeside, ''), '^https?://(www\.)?', '', 'i'), ''),
    'NO',
    e.naeringskode1_beskrivelse,
    e.aktivitet,
    CASE
      WHEN e.antall_ansatte IS NULL THEN NULL
      WHEN e.antall_ansatte = 0 THEN '0'
      WHEN e.antall_ansatte BETWEEN 1 AND 4 THEN '1-4'
      WHEN e.antall_ansatte BETWEEN 5 AND 19 THEN '5-19'
      WHEN e.antall_ansatte BETWEEN 20 AND 99 THEN '20-99'
      WHEN e.antall_ansatte BETWEEN 100 AND 499 THEN '100-499'
      ELSE '500+'
    END,
    CASE
      WHEN e.er_offentlig THEN 'public'
      WHEN e.organisasjonsform_kode IN ('FLI', 'STI') THEN 'nonprofit'
      ELSE 'private'
    END,
    now(),
    'brreg_orgnr',
    1.0
  FROM reg.enheter e
  WHERE e.organisasjonsnummer = v_orgnr
  ON CONFLICT (organisasjonsnummer)
    WHERE organisasjonsnummer IS NOT NULL
  DO UPDATE SET
    name = excluded.name,
    domain = coalesce(public.companies.domain, excluded.domain),
    country = coalesce(public.companies.country, excluded.country),
    industry = coalesce(public.companies.industry, excluded.industry),
    description = coalesce(public.companies.description, excluded.description),
    size_estimate = coalesce(excluded.size_estimate, public.companies.size_estimate),
    ownership_type = coalesce(public.companies.ownership_type, excluded.ownership_type),
    brreg_matched_at = now(),
    brreg_match_source = 'brreg_orgnr',
    brreg_match_confidence = 1.0,
    updated_at = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_company_for_employer(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_company_for_employer(text)
  TO service_role;

COMMENT ON FUNCTION public.ensure_company_for_employer(text) IS
  'Service-role-only deterministic company upsert by Bronnoysund organisation number. Never performs fuzzy matching.';

NOTIFY pgrst, 'reload schema';
