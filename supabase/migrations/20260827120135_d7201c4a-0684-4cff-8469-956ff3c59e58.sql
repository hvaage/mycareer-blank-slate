alter table public.user_career_profiles
  add column if not exists career_life_phase text
    check (career_life_phase in (
      'student_nyutdannet',
      'tidlig_karriere',
      'etablert_karriere',
      'senior_erfaren'
    ));