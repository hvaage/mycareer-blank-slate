create or replace function public.network_upsert_activity(
  p_user_id uuid,
  p_activity_id uuid,
  p_title text,
  p_description text,
  p_due_date date,
  p_priority text,
  p_activity_type text,
  p_status text,
  p_result_note text,
  p_activity_scope text,
  p_contact_id uuid,
  p_company_id uuid,
  p_opportunity_id uuid,
  p_application_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_id uuid;
  v_scope text := coalesce(nullif(p_activity_scope, ''), 'context');
  v_priority priority_level := coalesce(nullif(p_priority, ''), 'middels')::priority_level;
  v_title text := nullif(btrim(coalesce(p_title, '')), '');
begin
  if p_user_id is null then
    return jsonb_build_object('ok', false, 'error_code', 'missing_user');
  end if;
  if v_title is null then
    return jsonb_build_object('ok', false, 'error_code', 'missing_title');
  end if;
  if v_scope not in ('context', 'personal') then
    return jsonb_build_object('ok', false, 'error_code', 'invalid_scope');
  end if;
  if v_scope = 'context'
     and p_contact_id is null and p_company_id is null
     and p_opportunity_id is null and p_application_id is null then
    return jsonb_build_object('ok', false, 'error_code', 'missing_context');
  end if;

  -- Eierskap valideres eksplisitt; sammensatte FK-er er siste forsvarslinje.
  if p_contact_id is not null and not exists (
    select 1 from public.network_contacts c where c.id = p_contact_id and c.user_id = p_user_id
  ) then
    return jsonb_build_object('ok', false, 'error_code', 'foreign_contact');
  end if;
  if p_opportunity_id is not null and not exists (
    select 1 from public.user_opportunities o where o.id = p_opportunity_id and o.user_id = p_user_id
  ) then
    return jsonb_build_object('ok', false, 'error_code', 'foreign_opportunity');
  end if;
  if p_application_id is not null and not exists (
    select 1 from public.applications a where a.id = p_application_id and a.user_id = p_user_id
  ) then
    return jsonb_build_object('ok', false, 'error_code', 'foreign_application');
  end if;

  if p_activity_id is null then
    insert into public.next_steps (
      user_id, title, description, due_date, priority, activity_type, status,
      result_note, activity_scope, contact_id, company_id, opportunity_id, application_id
    ) values (
      p_user_id, v_title, nullif(btrim(coalesce(p_description, '')), ''), p_due_date, v_priority,
      coalesce(nullif(p_activity_type, ''), 'annet'), coalesce(nullif(p_status, ''), 'planlagt'),
      nullif(btrim(coalesce(p_result_note, '')), ''), v_scope,
      p_contact_id, p_company_id, p_opportunity_id, p_application_id
    )
    returning id into v_id;
  else
    update public.next_steps set
      title = v_title,
      description = nullif(btrim(coalesce(p_description, '')), ''),
      due_date = p_due_date,
      priority = v_priority,
      activity_type = coalesce(nullif(p_activity_type, ''), activity_type),
      status = coalesce(nullif(p_status, ''), status),
      result_note = nullif(btrim(coalesce(p_result_note, '')), ''),
      activity_scope = v_scope,
      contact_id = p_contact_id,
      company_id = p_company_id,
      opportunity_id = p_opportunity_id,
      application_id = p_application_id
    where id = p_activity_id and user_id = p_user_id
    returning id into v_id;

    if v_id is null then
      return jsonb_build_object('ok', false, 'error_code', 'not_found');
    end if;
  end if;

  return jsonb_build_object('ok', true, 'activity_id', v_id);
exception
  when others then
    return jsonb_build_object('ok', false, 'error_code', 'write_failed');
end;
$fn$;

create or replace function public.network_complete_activity(
  p_user_id uuid,
  p_activity_id uuid,
  p_status text,
  p_result_note text,
  p_completed_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_id uuid;
  v_status text := coalesce(nullif(p_status, ''), 'utfort');
begin
  if p_user_id is null or p_activity_id is null then
    return jsonb_build_object('ok', false, 'error_code', 'missing_input');
  end if;
  if v_status not in ('planlagt', 'pagaar', 'utfort', 'avlyst') then
    return jsonb_build_object('ok', false, 'error_code', 'invalid_status');
  end if;

  update public.next_steps set
    status = v_status,
    completed_at = case when v_status = 'utfort' then coalesce(p_completed_at, completed_at, now()) else null end,
    result_note = case
      when p_result_note is null then result_note
      else nullif(btrim(p_result_note), '')
    end
  where id = p_activity_id and user_id = p_user_id
  returning id into v_id;

  if v_id is null then
    return jsonb_build_object('ok', false, 'error_code', 'not_found');
  end if;
  return jsonb_build_object('ok', true, 'activity_id', v_id, 'status', v_status);
exception
  when others then
    return jsonb_build_object('ok', false, 'error_code', 'write_failed');
end;
$fn$;

revoke all on function public.network_upsert_activity(uuid, uuid, text, text, date, text, text, text, text, text, uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.network_upsert_activity(uuid, uuid, text, text, date, text, text, text, text, text, uuid, uuid, uuid, uuid) to service_role;
revoke all on function public.network_complete_activity(uuid, uuid, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.network_complete_activity(uuid, uuid, text, text, timestamptz) to service_role;
