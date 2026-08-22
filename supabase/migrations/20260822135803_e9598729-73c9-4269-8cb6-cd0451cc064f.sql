-- ============================================================
-- Fase 5C — dokument/mulighet-kobling, annonsekontakt, søknadsstart
-- ============================================================

-- 1) Bruker-scopet FK dokument -> mulighet ---------------------------------
alter table public.documents drop constraint if exists documents_opportunity_id_fkey;

alter table public.documents
  add constraint documents_opportunity_user_fkey
  foreign key (opportunity_id, user_id)
  references public.user_opportunities (id, user_id)
  on delete set null (opportunity_id);

create index if not exists documents_user_opportunity_idx
  on public.documents (user_id, opportunity_id);

-- 2) Annonsekontakt-observasjoner ------------------------------------------
create table if not exists public.network_posting_contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  opportunity_id uuid not null,
  source_posting_id uuid,
  source_contact_ref text not null,
  network_contact_id uuid,
  contact_name text,
  contact_role text,
  contact_email text,
  contact_phone text,
  source_class text not null default 'job_posting',
  observed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint network_posting_contacts_source_class_check check (source_class = 'job_posting'),
  constraint network_posting_contacts_opportunity_fkey
    foreign key (opportunity_id, user_id) references public.user_opportunities (id, user_id) on delete cascade,
  constraint network_posting_contacts_contact_fkey
    foreign key (network_contact_id, user_id) references public.network_contacts (id, user_id) on delete set null (network_contact_id),
  constraint network_posting_contacts_unique unique (user_id, opportunity_id, source_contact_ref)
);

grant select on public.network_posting_contacts to authenticated;
grant all on public.network_posting_contacts to service_role;

alter table public.network_posting_contacts enable row level security;

drop policy if exists "posting contacts are user scoped" on public.network_posting_contacts;
create policy "posting contacts are user scoped"
  on public.network_posting_contacts for select to authenticated
  using (auth.uid() = user_id);

create index if not exists network_posting_contacts_contact_idx
  on public.network_posting_contacts (user_id, network_contact_id);

-- 3) Stabil, serverutledet kontaktreferanse --------------------------------
create or replace function public.network_posting_contact_ref(
  p_source_posting_id uuid,
  p_contact jsonb
) returns text
language sql
immutable
set search_path = public
as $$
  select md5(
    coalesce(p_source_posting_id::text, '') || '|' ||
    lower(btrim(coalesce(p_contact->>'name', ''))) || '|' ||
    lower(btrim(coalesce(p_contact->>'email', ''))) || '|' ||
    regexp_replace(coalesce(p_contact->>'phone', ''), '\D', '', 'g')
  )
$$;

-- Leser annonsens kontaktpersoner direkte fra lagret annonsekilde.
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
    select id, source, last_seen_at, updated_at, raw_payload
    from public.source_postings
    where canonical_opportunity_id = v_canonical
    order by coalesce(last_seen_at, updated_at) desc nulls last
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

-- Oppretter eller kobler annonsekontakt. Kildeverdier leses på serveren.
create or replace function public.network_link_posting_contact(
  p_user_id uuid,
  p_opportunity_id uuid,
  p_source_contact_ref text,
  p_existing_contact_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source jsonb;
  v_match jsonb;
  v_contact_id uuid;
begin
  v_source := public.network_posting_contacts_for_opportunity(p_user_id, p_opportunity_id);
  if coalesce((v_source->>'ok')::boolean, false) is not true then
    return jsonb_build_object('ok', false, 'error_code', coalesce(v_source->>'error_code', 'source_unavailable'));
  end if;

  select value into v_match
  from jsonb_array_elements(v_source->'contacts') as value
  where value->>'source_contact_ref' = p_source_contact_ref
  limit 1;

  if v_match is null then
    return jsonb_build_object('ok', false, 'error_code', 'source_contact_not_found');
  end if;

  if p_existing_contact_id is not null then
    select id into v_contact_id
    from public.network_contacts
    where id = p_existing_contact_id and user_id = p_user_id;
    if v_contact_id is null then
      return jsonb_build_object('ok', false, 'error_code', 'contact_not_owned');
    end if;
  else
    insert into public.network_contacts (user_id, display_name, headline, company, source_system, source_ref, is_active, last_observed_at)
    values (
      p_user_id,
      coalesce(v_match->>'name', 'Kontaktperson i annonsen'),
      v_match->>'role',
      (select card_company from public.user_opportunities where id = p_opportunity_id and user_id = p_user_id),
      'job_posting',
      p_source_contact_ref,
      true,
      coalesce((v_match->>'observed_at')::timestamptz, now())
    )
    returning id into v_contact_id;
  end if;

  insert into public.network_posting_contacts (
    user_id, opportunity_id, source_posting_id, source_contact_ref, network_contact_id,
    contact_name, contact_role, contact_email, contact_phone, observed_at
  ) values (
    p_user_id,
    p_opportunity_id,
    nullif(v_match->>'source_posting_id', '')::uuid,
    p_source_contact_ref,
    v_contact_id,
    v_match->>'name',
    v_match->>'role',
    v_match->>'email',
    v_match->>'phone',
    coalesce((v_match->>'observed_at')::timestamptz, now())
  )
  on conflict (user_id, opportunity_id, source_contact_ref) do update
    set network_contact_id = excluded.network_contact_id,
        contact_name = excluded.contact_name,
        contact_role = excluded.contact_role,
        contact_email = excluded.contact_email,
        contact_phone = excluded.contact_phone,
        observed_at = excluded.observed_at,
        updated_at = now();

  return jsonb_build_object('ok', true, 'contact_id', v_contact_id);
end;
$$;

-- 4) Dokument <-> mulighet --------------------------------------------------
create or replace function public.network_link_document_opportunity(
  p_user_id uuid,
  p_document_id uuid,
  p_opportunity_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc uuid;
  v_opp uuid;
begin
  select id into v_doc from public.documents where id = p_document_id and user_id = p_user_id;
  if v_doc is null then
    return jsonb_build_object('ok', false, 'error_code', 'document_not_owned');
  end if;

  if p_opportunity_id is not null then
    select id into v_opp from public.user_opportunities where id = p_opportunity_id and user_id = p_user_id;
    if v_opp is null then
      return jsonb_build_object('ok', false, 'error_code', 'opportunity_not_owned');
    end if;
  end if;

  update public.documents
  set opportunity_id = p_opportunity_id, updated_at = now()
  where id = p_document_id and user_id = p_user_id;

  return jsonb_build_object('ok', true, 'document_id', p_document_id, 'opportunity_id', p_opportunity_id);
end;
$$;

-- 5) Idempotent søknadsstart fra annonse ------------------------------------
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
  from public.source_postings sp
  where sp.canonical_opportunity_id = p_canonical_opportunity_id
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

-- 6) Kun serverhandlinger kaller disse -------------------------------------
revoke all on function public.network_posting_contacts_for_opportunity(uuid, uuid) from public, anon, authenticated;
revoke all on function public.network_link_posting_contact(uuid, uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.network_link_document_opportunity(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.network_start_application_from_posting(uuid, uuid) from public, anon, authenticated;