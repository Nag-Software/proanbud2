-- 111_kalkulator_usage.sql
-- Kvote for den offentlige tilbudskalkulatoren (/kalkulator).
--
--   * Én rad per tilbud kalkulatoren faktisk har laget. Hvert tilbud koster
--     KI-tokens + nettprissøk, så gratiskvoten må håndheves på serveren —
--     den gamle grensen lå bare i en cookie og ble nullstilt av et
--     inkognitovindu (og av seg selv hver dag).
--
--   * visitor_id = tilfeldig ID fra en httpOnly-cookie (pa_kalk). Teller
--     for alltid: 3 gratis tilbud totalt per nettleser.
--     ip_hash    = SHA-256 av IP + salt (aldri rå IP). Teller i et rullerende
--     vindu, så tømte cookies / inkognito ikke gir ny kvote, samtidig som et
--     delt nett (mobil-NAT, kontor) ikke er sperret for alltid.
--
--   * claim_kalkulator_use() sjekker og bokfører i ÉN transaksjon bak en
--     advisory lock — parallelle forespørsler kan ikke snike seg forbi grensa.
--     Den håndhever også et globalt dagstak som ren kostnadsbrems.
--
-- Skrives og leses kun av serveren med service role — RLS er på uten policies
-- (deny-all), som error_logs (db/50).
--
-- Additiv: kan kjøres i prod før koden deployes. Safe to run repeatedly.

CREATE TABLE IF NOT EXISTS public.kalkulator_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visitor_id TEXT NOT NULL,
  ip_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kalkulator_usage_visitor
  ON public.kalkulator_usage (visitor_id);

CREATE INDEX IF NOT EXISTS idx_kalkulator_usage_ip
  ON public.kalkulator_usage (ip_hash, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_kalkulator_usage_created
  ON public.kalkulator_usage (created_at DESC);

ALTER TABLE public.kalkulator_usage ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.claim_kalkulator_use(
  p_visitor_id TEXT,
  p_ip_hash TEXT,
  p_limit INT,
  p_ip_window_days INT,
  p_global_daily_limit INT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_visitor INT := 0;
  v_ip INT := 0;
  v_global INT := 0;
  v_used INT;
  v_id UUID;
BEGIN
  -- Én global lås: volumet er lavt og transaksjonen er bitteliten, og da blir
  -- også det globale dagstaket eksakt.
  PERFORM pg_advisory_xact_lock(hashtext('kalkulator_usage'));

  SELECT count(*) INTO v_visitor
    FROM public.kalkulator_usage
   WHERE visitor_id = p_visitor_id;

  IF p_ip_hash IS NOT NULL THEN
    SELECT count(*) INTO v_ip
      FROM public.kalkulator_usage
     WHERE ip_hash = p_ip_hash
       AND created_at > now() - make_interval(days => p_ip_window_days);
  END IF;

  v_used := greatest(v_visitor, v_ip);
  IF v_used >= p_limit THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'limit', 'used', v_used);
  END IF;

  SELECT count(*) INTO v_global
    FROM public.kalkulator_usage
   WHERE created_at > now() - interval '24 hours';

  IF v_global >= p_global_daily_limit THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'global', 'used', v_used);
  END IF;

  INSERT INTO public.kalkulator_usage (visitor_id, ip_hash)
  VALUES (p_visitor_id, p_ip_hash)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('allowed', true, 'id', v_id, 'used', v_used + 1);
END;
$$;

REVOKE ALL ON FUNCTION public.claim_kalkulator_use(TEXT, TEXT, INT, INT, INT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_kalkulator_use(TEXT, TEXT, INT, INT, INT)
  TO service_role;
