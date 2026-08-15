alter table public.career_atoms drop constraint career_atoms_kompetanse_verified_ck;
alter table public.career_atoms add constraint career_atoms_kompetanse_verified_ck check (
  not (atom_type = 'skill' and confidence = 'verified')
  or coalesce(array_length(evidence_atom_ids, 1), 0) >= 1
);