CREATE INDEX IF NOT EXISTS oauth_grants_client_idx ON public.oauth_grants (client_id);
CREATE INDEX IF NOT EXISTS oauth_authorization_codes_client_idx ON public.oauth_authorization_codes (client_id);
CREATE INDEX IF NOT EXISTS oauth_authorization_codes_user_idx ON public.oauth_authorization_codes (user_id);
CREATE INDEX IF NOT EXISTS oauth_authorization_codes_integration_idx ON public.oauth_authorization_codes (ai_integration_id);
CREATE INDEX IF NOT EXISTS oauth_refresh_tokens_parent_idx ON public.oauth_refresh_tokens (parent_id);
CREATE INDEX IF NOT EXISTS oauth_security_events_client_idx ON public.oauth_security_events (client_row_id);
CREATE INDEX IF NOT EXISTS oauth_security_events_grant_idx ON public.oauth_security_events (grant_id);
CREATE INDEX IF NOT EXISTS oauth_security_events_user_idx ON public.oauth_security_events (user_id);