insert into ai.model_profiles
  (task_key, profile_key, model_id, prompt_version, max_tokens, cost_tier, request_options, capabilities, is_active)
values
  ('cv_atom_language_no_v2_1', 'cv_atom_language_no_v2_1', 'claude-sonnet-4-6', '2.1.0', 16000, 'standard', '{}'::jsonb,
   '{"supportsTemperature": false, "supportsTopP": false, "supportsTopK": false, "supportsThinking": false, "supportsPrefill": false}'::jsonb,
   true)
on conflict (profile_key) do update
  set model_id = excluded.model_id,
      prompt_version = excluded.prompt_version,
      max_tokens = excluded.max_tokens,
      is_active = true,
      updated_at = now();