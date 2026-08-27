CREATE OR REPLACE FUNCTION public.network_start_application_from_posting(p_user_id uuid, p_canonical_opportunity_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
declare
  v_existing uuid;
  v_existing_status text;
  v_posting record;
  v_new uuid;
begin
  select id, status into v_existing, v_existing_status
  from public.user_opportunities
  where user_id = p_user_id and canonical_opportunity_id = p_canonical_opportunity_id;

  if v_existing is not null then
    -- Uvalgte treff fra speilet ligger som 'new'/'ny'/'pending'. Et bevisst
    -- klikk på «Start søknadsarbeid» gjør dem til en valgt mulighet.
    if coalesce(lower(v_existing_status), 'new') in ('new', 'ny', 'pending', 'ikke_vurdert') then
      update public.user_opportunities
        set status = 'saved'
      where id = v_existing;
    end if;
    return jsonb_build_object('ok', true, 'opportunity_id', v_existing, 'created', false);
  end if;

  select sp.id, sp.title, sp.company, sp.location, sp.display_url, sp.raw_url,
         sp.published_at, sp.source, sp.identity_fingerprint
  into v_posting
  from public.opportunity_source_links osl
  join public.source_postings sp on sp.id = osl.source_posting_id
  where osl.canonical_opportunity_id = p_canonical_opportunity_id
  order by coalesce(sp.last_seen_at, sp.updated_at) desc nulls last
  limit 1;

  if v_posting.id is null then
    return jsonb_build_object('ok', false, 'error_code', 'posting_not_found');
  end if;

  insert into public.user_opportunities (
    user_id, canonical_opportunity_id, identity_fingerprint,
    card_title, card_company, card_location, card_display_url, card_raw_url,
    card_published_at, card_source, status
  ) values (
    p_user_id, p_canonical_opportunity_id, v_posting.identity_fingerprint,
    v_posting.title, v_posting.company, v_posting.location, v_posting.display_url, v_posting.raw_url,
    v_posting.published_at, v_posting.source, 'saved'
  )
  on conflict (user_id, canonical_opportunity_id) do nothing
  returning id into v_new;

  if v_new is null then
    select id into v_new from public.user_opportunities
    where user_id = p_user_id and canonical_opportunity_id = p_canonical_opportunity_id;
    update public.user_opportunities
      set status = 'saved'
    where id = v_new
      and coalesce(lower(status), 'new') in ('new', 'ny', 'pending', 'ikke_vurdert');
    return jsonb_build_object('ok', true, 'opportunity_id', v_new, 'created', false);
  end if;

  return jsonb_build_object('ok', true, 'opportunity_id', v_new, 'created', true);
end;
$fn$;

REVOKE ALL ON FUNCTION public.network_start_application_from_posting(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.network_start_application_from_posting(uuid, uuid) TO service_role;