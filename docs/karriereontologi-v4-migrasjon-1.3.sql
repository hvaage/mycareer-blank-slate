-- Karriereontologi v4, fase 1.3: public.career_atoms
-- UTKAST TIL GODKJENNING. Ikke kjørt. Kjøres via migrasjonsverktøyet når du sier fra.

create table public.career_atoms (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  atom_kind text not null check (atom_kind in ('evidens','mangel','onske','maal','begrensning','verdi')),
  atom_type text check (atom_type in (
    'role','achievement','metric','context','tool','education','skill',
    'domain','language','certification','project','volunteer','summary_fragment'
  )),
  atom_class text generated always as (
    case atom_type
      when 'skill' then 'kompetanse'
      when 'education' then 'kvalifikasjon'
      when 'certification' then 'kvalifikasjon'
      when 'language' then 'kvalifikasjon'
      when 'domain' then 'eksponering'
      when 'tool' then 'instrument'
      when 'achievement' then 'resultat'
      when 'metric' then 'resultat'
      when 'project' then 'resultat'
      when 'volunteer' then 'resultat'
      else null
    end
  ) stored,
  parent_atom_id uuid references public.career_atoms(id) on delete cascade,
  content_no text,
  content_en text,
  structured_data jsonb not null default '{}'::jsonb,

  source_type text not null,
  source_ref text,
  source_quote text,
  evidence_atom_ids uuid[] not null default '{}'::uuid[],

  confidence text not null default 'imported'
    check (confidence in ('imported','inferred','verified')),
  attestation text
    check (attestation in ('selvrapportert','dokumentert','bekreftet_av_leder','bekreftet_tredjepart')),
  viktighet smallint,

  user_confirmed boolean not null default false,
  user_locked boolean not null default false,
  is_active boolean not null default true,
  refreshed_at timestamptz,
  stale_at timestamptz,
  last_seen_at timestamptz default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  due_at timestamptz,
  state text check (state in ('planlagt','i_arbeid','oppnadd','forkastet')),
  mangel_state text check (mangel_state in ('identifisert','i_arbeid','lukket','forkastet')),
  valid_from date,
  valid_to date,
  target_position_id uuid,
  target_requirement_id uuid,

  -- 1. atom_type kun (og alltid) for evidens
  constraint career_atoms_type_kind_ck check (
    (atom_kind = 'evidens' and atom_type is not null)
    or (atom_kind <> 'evidens' and atom_type is null)
  ),
  -- 2. attestation kun for evidens
  constraint career_atoms_attestation_ck check (
    attestation is null or atom_kind = 'evidens'
  ),
  -- 3. viktighet kun for onske/verdi/begrensning, 1-6
  constraint career_atoms_viktighet_ck check (
    (viktighet is null and atom_kind not in ('onske','verdi','begrensning'))
    or (atom_kind in ('onske','verdi','begrensning') and (viktighet is null or viktighet between 1 and 6))
  ),
  -- 4. parent_atom_id kun for evidens
  constraint career_atoms_parent_ck check (
    parent_atom_id is null or atom_kind = 'evidens'
  ),
  -- 5. kompetanse + verified krever minst én peker
  constraint career_atoms_kompetanse_verified_ck check (
    not (atom_type = 'skill' and confidence = 'verified')
    or array_length(evidence_atom_ids, 1) >= 1
  ),
  -- 7. maal krever state, mangel krever mangel_state
  constraint career_atoms_maal_state_ck check (atom_kind <> 'maal' or state is not null),
  constraint career_atoms_mangel_state_ck check (atom_kind <> 'mangel' or mangel_state is not null),
  -- 8. begrensning krever valid_from
  constraint career_atoms_begrensning_ck check (atom_kind <> 'begrensning' or valid_from is not null)
);

comment on table public.career_atoms is
  'Karriereontologi v4. Ett atom per påstand om brukeren. atom_class avledes av atom_type og kan ikke settes fra applikasjonen.';

comment on column public.career_atoms.viktighet is
  '1 = uvesentlig, nevnt men uten vekt
2 = svak preferanse, ville ikke påvirket et valg alene
3 = reell preferanse, teller når alt annet er likt
4 = viktig, veier tyngre enn flere mindre forhold
5 = svært viktig, må adresseres for at et alternativ skal være aktuelt
6 = avgjørende, brudd på denne diskvalifiserer alternativet
Skalaen er brukerens egen vurdering, ikke systemets. Den er identisk med
1–6-skalaen i user_career_profiles. Den skal ikke normaliseres til 0–1.';

comment on column public.career_atoms.confidence is 'Opprinnelse: imported, inferred, verified. Ikke en styrkegrad.';
comment on column public.career_atoms.attestation is 'Hvem som står bak påstanden. Kun for evidens.';
comment on column public.career_atoms.target_position_id is 'Målposisjon for maal og mangel. Nullbar inntil målposisjonstabellen finnes i fase 3.1.';

-- 6. eksponering krever at forelderen er et rolleatom (oppslag => trigger)
create or replace function public.career_atoms_eksponering_parent_check()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.atom_type = 'domain' then
    if new.parent_atom_id is null then
      raise exception 'eksponering (atom_type=domain) krever parent_atom_id som peker på et role-atom';
    end if;
    if not exists (
      select 1 from public.career_atoms p
      where p.id = new.parent_atom_id and p.atom_type = 'role'
    ) then
      raise exception 'eksponering (atom_type=domain) krever at parent_atom_id peker på et atom med atom_type=role';
    end if;
  end if;
  return new;
end;
$$;

create trigger career_atoms_eksponering_parent
  before insert or update on public.career_atoms
  for each row execute function public.career_atoms_eksponering_parent_check();

create trigger set_career_atoms_updated_at
  before update on public.career_atoms
  for each row execute function public.update_updated_at_column();

create index idx_career_atoms_user_kind_active on public.career_atoms (user_id, atom_kind, is_active);
create index idx_career_atoms_user_class on public.career_atoms (user_id, atom_class) where atom_kind = 'evidens';
create index idx_career_atoms_parent on public.career_atoms (parent_atom_id);
create index idx_career_atoms_evidence_ids on public.career_atoms using gin (evidence_atom_ids);
create index idx_career_atoms_user_stale on public.career_atoms (user_id, stale_at) where is_active;

grant select, insert, update, delete on public.career_atoms to authenticated;
grant all on public.career_atoms to service_role;

alter table public.career_atoms enable row level security;

create policy "career_atoms_select_own" on public.career_atoms
  for select to authenticated using (auth.uid() = user_id);
create policy "career_atoms_insert_own" on public.career_atoms
  for insert to authenticated with check (auth.uid() = user_id);
create policy "career_atoms_update_own" on public.career_atoms
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "career_atoms_delete_own" on public.career_atoms
  for delete to authenticated using (auth.uid() = user_id);
