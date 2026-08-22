create or replace function public.network_posting_contacts_for_opportunity(
  p_user_id uuid,
  p_opportunity_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_canonical uuid;
  v_out jsonb := '[]'::jsonb;
  v_posting record;
  v_list jsonb;
  v_item jsonb;
begin
  select canonical_opportunity_id into v_canonical
  from public.user_opportunities
  where id = p_opportunity_id and user_id = p_user_id;

  if v_canonical is null then
    return jsonb_build_object('ok', false, 'error_code', 'opportunity_not_found');
  end if;

  for v_posting in
    select sp.id, sp.source, sp.last_seen_at, sp.updated_at, sp.raw_payload
    from public.opportunity_source_links osl
    join public.source_postings sp on sp.id = osl.source_posting_id
    where osl.canonical_opportunity_id = v_canonical
    order by coalesce(sp.last_seen_at, sp.updated_at) desc nulls last
    limit 5
  loop
    v_list := jsonb_path_query_first(coalesce(v_posting.raw_payload, '{}'::jsonb), '$.**.contactList');
    if v_list is null or jsonb_typeof(v_list) <> 'array' then
      continue;
    end if;

    for v_item in select value from jsonb_array_elements(v_list)
    loop
      if coalesce(btrim(v_item->>'name'), '') = ''
         and coalesce(btrim(v_item->>'email'), '') = ''
         and coalesce(btrim(v_item->>'phone'), '') = '' then
        continue;
      end if;
      v_out := v_out || jsonb_build_array(jsonb_build_object(
        'source_contact_ref', public.network_posting_contact_ref(v_posting.id, v_item),
        'source_posting_id', v_posting.id,
        'source', v_posting.source,
        'observed_at', coalesce(v_posting.last_seen_at, v_posting.updated_at),
        'name', nullif(btrim(coalesce(v_item->>'name', '')), ''),
        'role', nullif(btrim(coalesce(nullif(v_item->>'title', ''), v_item->>'role', '')), ''),
        'email', nullif(btrim(coalesce(v_item->>'email', '')), ''),
        'phone', nullif(btrim(coalesce(v_item->>'phone', '')), '')
      ));
    end loop;

    exit when jsonb_array_length(v_out) > 0;
  end loop;

  return jsonb_build_object('ok', true, 'contacts', v_out);
end;
$$;

create or replace function public.network_start_application_from_posting(
  p_user_id uuid,
  p_canonical_opportunity_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing uuid;
  v_posting record;
  v_new uuid;
begin
  select id into v_existing
  from public.user_opportunities
  where user_id = p_user_id and canonical_opportunity_id = p_canonical_opportunity_id;

  if v_existing is not null then
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
    v_posting.published_at, v_posting.source, 'ny'
  )
  on conflict (user_id, canonical_opportunity_id) do nothing
  returning id into v_new;

  if v_new is null then
    select id into v_new from public.user_opportunities
    where user_id = p_user_id and canonical_opportunity_id = p_canonical_opportunity_id;
    return jsonb_build_object('ok', true, 'opportunity_id', v_new, 'created', false);
  end if;

  return jsonb_build_object('ok', true, 'opportunity_id', v_new, 'created', true);
end;
$$;

revoke all on function public.network_posting_contacts_for_opportunity(uuid, uuid) from public, anon, authenticated;
revoke all on function public.network_start_application_from_posting(uuid, uuid) from public, anon, authenticated;