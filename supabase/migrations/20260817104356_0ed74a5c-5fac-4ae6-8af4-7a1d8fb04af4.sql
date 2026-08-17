
create or replace function public.cv_review_basis_reconcile(p_import_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
  v_updates int := 0;
  v_blocked jsonb := '[]'::jsonb;
begin
  select user_id into v_user from public.cv_imports where id = p_import_id;
  if v_user is null then
    raise exception 'Ukjent import';
  end if;
  if auth.uid() is not null and auth.uid() <> v_user then
    raise exception 'Ingen tilgang til denne importen';
  end if;

  with p as (
    select pr.proposal_payload->'structured_data' d
    from public.atom_enrichment_proposals pr
    join public.atom_enrichment_batches b on b.id = pr.batch_id
    where b.source_id = p_import_id::text
      and pr.proposal_payload->>'atom_type' = 'role'
  ), upd as (
    update public.cv_parse_candidates c
    set suggested_atom_type = 'role',
        parent_local_ref = null,
        structured_data = coalesce(c.structured_data,'{}'::jsonb) || jsonb_build_object(
          'original_suggested_atom_type', coalesce(c.structured_data->'original_suggested_atom_type', to_jsonb(c.suggested_atom_type)),
          'v2_role_local_id', p.d->>'local_id',
          'v2_reconciled', true,
          'title', case when coalesce((p.d->>'provisional')::boolean,false) then 'null'::jsonb else coalesce(p.d->'title','null'::jsonb) end,
          'employer', coalesce(p.d->'employer','null'::jsonb),
          'start_date', coalesce(p.d->'start_date','null'::jsonb),
          'end_date', coalesce(p.d->'end_date','null'::jsonb),
          'date_precision', coalesce(p.d->'date_precision','null'::jsonb),
          'appointment_relation', coalesce(p.d->'appointment_relation','null'::jsonb),
          'concurrent_with_role_local_ids', coalesce(p.d->'concurrent_with_role_local_ids','[]'::jsonb),
          'provisional', coalesce((p.d->>'provisional')::boolean,false),
          'needs_role_title', (coalesce((p.d->>'provisional')::boolean,false) or nullif(p.d->>'title','') is null),
          'needs_review_reason', coalesce(p.d->'needs_review_reason','null'::jsonb)
        ),
        updated_at = now()
    from p
    where c.import_id = p_import_id
      and c.local_ref = p.d->>'parse_local_ref'
      and c.status = 'ubehandlet'
      and c.promoted_atom_id is null
      and coalesce(c.suggested_atom_type,'') <> 'role'
    returning 1
  )
  select count(*) into v_updates from upd;

  with r as (
    select pr.proposal_payload->'structured_data'->>'local_id' as role_local_id,
           pr.proposal_payload->'structured_data'->>'parse_local_ref' as role_ref
    from public.atom_enrichment_proposals pr
    join public.atom_enrichment_batches b on b.id = pr.batch_id
    where b.source_id = p_import_id::text
      and pr.proposal_payload->>'atom_type' = 'role'
  ), a as (
    select pr.proposal_payload->'structured_data'->>'parse_local_ref' as ref,
           pr.proposal_payload->'structured_data'->>'role_local_id' as role_local_id,
           pr.proposal_payload->'structured_data'->>'content_kind' as content_kind
    from public.atom_enrichment_proposals pr
    join public.atom_enrichment_batches b on b.id = pr.batch_id
    where b.source_id = p_import_id::text
      and pr.proposal_payload->>'atom_type' in ('achievement','role_evidence')
  ), upd2 as (
    update public.cv_parse_candidates c
    set parent_local_ref = r.role_ref,
        structured_data = coalesce(c.structured_data,'{}'::jsonb) || jsonb_build_object(
          'v2_reconciled', true,
          'v2_role_local_id', a.role_local_id,
          'content_kind', coalesce(a.content_kind, 'result')
        ),
        updated_at = now()
    from a
    join r on r.role_local_id = a.role_local_id
    where c.import_id = p_import_id
      and c.local_ref = a.ref
      and c.status = 'ubehandlet'
      and c.promoted_atom_id is null
      and coalesce(c.suggested_atom_type,'') <> 'role'
      and coalesce(c.parent_local_ref,'') is distinct from r.role_ref
    returning 1
  )
  select v_updates + count(*) into v_updates from upd2;

  select coalesce(jsonb_agg(jsonb_build_object(
           'local_ref', c.local_ref,
           'status', c.status,
           'promoted_atom_id', c.promoted_atom_id,
           'current_title', c.structured_data->>'title')), '[]'::jsonb)
    into v_blocked
  from public.cv_parse_candidates c
  where c.import_id = p_import_id
    and (c.status <> 'ubehandlet' or c.promoted_atom_id is not null)
    and exists (
      select 1
      from public.atom_enrichment_proposals pr
      join public.atom_enrichment_batches b on b.id = pr.batch_id
      where b.source_id = p_import_id::text
        and pr.proposal_payload->>'atom_type' = 'role'
        and pr.proposal_payload->'structured_data'->>'parse_local_ref' = c.local_ref
        and (
          coalesce((pr.proposal_payload->'structured_data'->>'provisional')::boolean,false)
          or nullif(pr.proposal_payload->'structured_data'->>'title','') is null
          or nullif(pr.proposal_payload->'structured_data'->>'title','') is distinct from nullif(c.structured_data->>'title','')
        )
    );

  return jsonb_build_object('updates', v_updates, 'blocked', v_blocked);
end;
$$;

revoke all on function public.cv_review_basis_reconcile(uuid) from public;
grant execute on function public.cv_review_basis_reconcile(uuid) to authenticated, service_role;

select public.cv_review_basis_reconcile('a5f8f87d-ba1c-400c-8cb2-5e6e1e63313c');
