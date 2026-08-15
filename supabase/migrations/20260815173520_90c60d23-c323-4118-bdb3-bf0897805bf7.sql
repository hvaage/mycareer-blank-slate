-- Smalt søkespeil for arbeidsgiversøk (del 2, punkt 1)

CREATE OR REPLACE FUNCTION reg.sok_norm(p text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT nullif(btrim(
    regexp_replace(
      btrim(regexp_replace(
        regexp_replace(lower(coalesce(p, '')), '[^a-z0-9æøå]+', ' ', 'g'),
        '\s+', ' ', 'g'
      )),
      '( (as|asa|ans|da|sa|ba|nuf|kf|fkf|iks|hf|sf|al|enk|bl|ks|stiftelse))+$', '', 'g'
    )
  ), '')
$$;

CREATE TABLE IF NOT EXISTS reg.enheter_sok (
  organisasjonsnummer text PRIMARY KEY,
  navn text NOT NULL,
  navn_norm text,
  antall_ansatte integer
);

CREATE OR REPLACE FUNCTION reg.enheter_sok_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'reg', 'public'
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM reg.enheter_sok WHERE organisasjonsnummer = OLD.organisasjonsnummer;
    RETURN OLD;
  END IF;

  IF coalesce(NEW.slettet, false) THEN
    DELETE FROM reg.enheter_sok WHERE organisasjonsnummer = NEW.organisasjonsnummer;
    RETURN NEW;
  END IF;

  INSERT INTO reg.enheter_sok (organisasjonsnummer, navn, navn_norm, antall_ansatte)
  VALUES (NEW.organisasjonsnummer, NEW.navn, reg.sok_norm(NEW.navn), NEW.antall_ansatte)
  ON CONFLICT (organisasjonsnummer) DO UPDATE
    SET navn = EXCLUDED.navn,
        navn_norm = EXCLUDED.navn_norm,
        antall_ansatte = EXCLUDED.antall_ansatte;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enheter_sok_sync_ins ON reg.enheter;
CREATE TRIGGER trg_enheter_sok_sync_ins
AFTER INSERT ON reg.enheter
FOR EACH ROW
EXECUTE FUNCTION reg.enheter_sok_sync();

DROP TRIGGER IF EXISTS trg_enheter_sok_sync_upd ON reg.enheter;
CREATE TRIGGER trg_enheter_sok_sync_upd
AFTER UPDATE ON reg.enheter
FOR EACH ROW
WHEN (
  OLD.navn IS DISTINCT FROM NEW.navn
  OR OLD.antall_ansatte IS DISTINCT FROM NEW.antall_ansatte
  OR coalesce(OLD.slettet, false) IS DISTINCT FROM coalesce(NEW.slettet, false)
)
EXECUTE FUNCTION reg.enheter_sok_sync();

DROP TRIGGER IF EXISTS trg_enheter_sok_sync_del ON reg.enheter;
CREATE TRIGGER trg_enheter_sok_sync_del
AFTER DELETE ON reg.enheter
FOR EACH ROW
EXECUTE FUNCTION reg.enheter_sok_sync();

CREATE OR REPLACE FUNCTION reg.enheter_sok_backfill(p_batch integer DEFAULT 50000)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'reg', 'public'
SET statement_timeout TO '240s'
AS $$
DECLARE n bigint;
BEGIN
  WITH src AS (
    SELECT e.organisasjonsnummer, e.navn, e.antall_ansatte
    FROM reg.enheter e
    WHERE coalesce(e.slettet, false) = false
      AND e.navn IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM reg.enheter_sok m
        WHERE m.organisasjonsnummer = e.organisasjonsnummer
      )
    ORDER BY e.organisasjonsnummer
    LIMIT greatest(coalesce(p_batch, 50000), 1)
  ), ins AS (
    INSERT INTO reg.enheter_sok (organisasjonsnummer, navn, navn_norm, antall_ansatte)
    SELECT s.organisasjonsnummer, s.navn, reg.sok_norm(s.navn), s.antall_ansatte
    FROM src s
    ON CONFLICT (organisasjonsnummer) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO n FROM ins;
  RETURN n;
END;
$$;
