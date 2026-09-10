-- ============================================================
-- Kanarietest: public.oauth_upsert_cimd_client
--
-- Kjøres i en transaksjon som RULLES TILBAKE. Ingen produksjonsdata endres.
--   BEGIN; \i scripts/canary/oauth-cimd-upsert-tests.sql ROLLBACK;
--
-- Dekker:
--   1. Codex' faktiske metadata kan caches (portløse loopback-maler).
--   2. Ekstra URI utover de to malene avvises.
--   3. Ufullstendig malsett for Codex avvises.
--   4. client_id ulik metadata_url avvises.
--   5. Vilkårlig http-redirect for annen CIMD-klient avvises.
--   6. Vanlig https-CIMD (ChatGPT) fungerer som før.
--   7. Claude Code kan blande verifisert https og portløs loopback-mal.
--   8. Manuelt registrert klient kan ikke overskrives.
--   9. Kun service_role kan kjøre funksjonen, og den er SECURITY INVOKER.
-- ============================================================

BEGIN;

CREATE TEMP TABLE canary(name text, result text) ON COMMIT DROP;

DO $$
DECLARE
  r record;
  codex  CONSTANT text := 'https://chatgpt.com/oauth/codex/client.json';
  claude CONSTANT text := 'https://claude.ai/oauth/claude-code-client-metadata';
  gpt    CONSTANT text := 'https://chatgpt.com/oauth/client.json';
  sc     CONSTANT text[] := ARRAY['karriere.status.read','karriere.workflow.run'];
  exp    CONSTANT timestamptz := now() + interval '6 hours';
BEGIN
  BEGIN
    SELECT * INTO r FROM public.oauth_upsert_cimd_client(
      codex, 'Codex', codex,
      ARRAY['http://127.0.0.1/callback','http://localhost/callback'], sc, exp);
    INSERT INTO canary VALUES ('1 codex metadata caches',
      CASE WHEN r.id IS NOT NULL AND r.registration_method = 'cimd' AND r.is_active
           THEN 'PASS' ELSE 'FAIL' END);
  EXCEPTION WHEN OTHERS THEN INSERT INTO canary VALUES ('1 codex metadata caches','FAIL '||SQLERRM); END;

  BEGIN
    PERFORM public.oauth_upsert_cimd_client(codex,'Codex',codex,
      ARRAY['http://127.0.0.1/callback','http://localhost/callback','http://127.0.0.1:1234/callback'], sc, exp);
    INSERT INTO canary VALUES ('2 ekstra uri avvises','FAIL (godtatt)');
  EXCEPTION WHEN OTHERS THEN INSERT INTO canary VALUES ('2 ekstra uri avvises','PASS '||SQLERRM); END;

  BEGIN
    PERFORM public.oauth_upsert_cimd_client(codex,'Codex',codex,
      ARRAY['http://127.0.0.1/callback'], sc, exp);
    INSERT INTO canary VALUES ('3 ufullstendig malsett avvises','FAIL (godtatt)');
  EXCEPTION WHEN OTHERS THEN INSERT INTO canary VALUES ('3 ufullstendig malsett avvises','PASS '||SQLERRM); END;

  BEGIN
    PERFORM public.oauth_upsert_cimd_client(codex,'Codex',gpt,
      ARRAY['http://127.0.0.1/callback','http://localhost/callback'], sc, exp);
    INSERT INTO canary VALUES ('4 id/metadata-mismatch avvises','FAIL (godtatt)');
  EXCEPTION WHEN OTHERS THEN INSERT INTO canary VALUES ('4 id/metadata-mismatch avvises','PASS '||SQLERRM); END;

  BEGIN
    PERFORM public.oauth_upsert_cimd_client(gpt,'X',gpt, ARRAY['http://evil.example/callback'], sc, exp);
    INSERT INTO canary VALUES ('5 vilkarlig http avvises','FAIL (godtatt)');
  EXCEPTION WHEN OTHERS THEN INSERT INTO canary VALUES ('5 vilkarlig http avvises','PASS '||SQLERRM); END;

  BEGIN
    SELECT * INTO r FROM public.oauth_upsert_cimd_client(gpt,'ChatGPT',gpt,
      ARRAY['https://chatgpt.com/connector_platform_oauth_redirect'], sc, exp);
    INSERT INTO canary VALUES ('6 https-cimd uendret',
      CASE WHEN r.id IS NOT NULL THEN 'PASS' ELSE 'FAIL' END);
  EXCEPTION WHEN OTHERS THEN INSERT INTO canary VALUES ('6 https-cimd uendret','FAIL '||SQLERRM); END;

  BEGIN
    SELECT * INTO r FROM public.oauth_upsert_cimd_client(claude,'Claude Code',claude,
      ARRAY['http://localhost/callback','https://claude.ai/api/mcp/auth_callback'], sc, exp);
    INSERT INTO canary VALUES ('7 claude blandet sett',
      CASE WHEN r.id IS NOT NULL THEN 'PASS' ELSE 'FAIL' END);
  EXCEPTION WHEN OTHERS THEN INSERT INTO canary VALUES ('7 claude blandet sett','FAIL '||SQLERRM); END;

  INSERT INTO public.oauth_clients
    (client_id, client_name, client_type, redirect_uris, allowed_scopes, registration_method, is_active)
  VALUES ('manual-canary-client','Manuell','public',
          ARRAY['https://example.com/cb'], sc, 'manual', true);
  BEGIN
    PERFORM public.oauth_upsert_cimd_client('manual-canary-client','Kapret',gpt,
      ARRAY['https://chatgpt.com/connector_platform_oauth_redirect'], sc, exp);
    INSERT INTO canary VALUES ('8 manuell klient beskyttet','FAIL (overskrevet)');
  EXCEPTION WHEN OTHERS THEN INSERT INTO canary VALUES ('8 manuell klient beskyttet','PASS '||SQLERRM); END;
END $$;

INSERT INTO canary
SELECT '9 privilegier',
  CASE WHEN NOT has_function_privilege('anon', f, 'EXECUTE')
        AND NOT has_function_privilege('authenticated', f, 'EXECUTE')
        AND has_function_privilege('service_role', f, 'EXECUTE')
        AND NOT (SELECT prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND p.proname = 'oauth_upsert_cimd_client')
       THEN 'PASS' ELSE 'FAIL' END
FROM (SELECT 'public.oauth_upsert_cimd_client(text,text,text,text[],text[],timestamptz)'::text AS f) s;

SELECT * FROM canary ORDER BY name;

ROLLBACK;
