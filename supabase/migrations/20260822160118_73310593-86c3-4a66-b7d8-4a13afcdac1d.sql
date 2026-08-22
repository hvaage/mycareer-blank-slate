create or replace function public.network_store_worker_secret(p_secret text)
returns void
language plpgsql
security definer
set search_path = public, vault
as $$
declare v_id uuid;
begin
  select id into v_id from vault.secrets where name = 'network_suggestions_worker_secret';
  if v_id is null then
    perform vault.create_secret(p_secret, 'network_suggestions_worker_secret', 'Worker secret for network suggestion cron');
  else
    perform vault.update_secret(v_id, p_secret);
  end if;
end;
$$;

revoke all on function public.network_store_worker_secret(text) from public, anon, authenticated;
grant execute on function public.network_store_worker_secret(text) to service_role;