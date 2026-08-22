INSERT INTO ai.model_profiles
  (profile_key, task_key, model_id, prompt_version, max_tokens, request_options, capabilities, cost_tier, is_active)
VALUES (
  'network_activity_suggestions_v1',
  'network_activity_suggestions',
  'claude-sonnet-4-6',
  '1.0.0',
  4000,
  '{}'::jsonb,
  '{"supportsTemperature": false, "supportsTopP": false, "supportsTopK": false, "supportsThinking": false, "supportsPrefill": false}'::jsonb,
  'standard',
  true
)
ON CONFLICT (profile_key) DO NOTHING;