update ai.model_profiles
set prompt_version = '2.1.1', updated_at = now()
where task_key = 'cv_atom_language_no_v2_1' and prompt_version = '2.1.0';