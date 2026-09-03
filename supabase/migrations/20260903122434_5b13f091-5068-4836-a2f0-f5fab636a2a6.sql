INSERT INTO ai.model_profiles (profile_key, task_key, model_id, prompt_version, max_tokens, request_options, capabilities, cost_tier, is_active)
VALUES (
  'occupation_esco_match_v1',
  'occupation_esco_match',
  'claude-haiku-4-5-20251001',
  '1.0.0',
  600,
  '{}'::jsonb,
  '{"supportsTemperature": false, "supportsTopP": false, "supportsTopK": false, "supportsThinking": false, "supportsPrefill": false}'::jsonb,
  'cheap',
  true
)
ON CONFLICT (profile_key) DO UPDATE
  SET max_tokens = EXCLUDED.max_tokens,
      model_id = EXCLUDED.model_id,
      is_active = true,
      updated_at = now();