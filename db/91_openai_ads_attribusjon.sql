-- ============================================================================
-- 91: OpenAI Ads (ChatGPT) — klikk-attribusjon og konverteringsjournal
--
-- Annonseklikket i ChatGPT bærer en klikk-referanse `oppref` i URL-en.
-- Markedssiden lagrer den i en førsteparts __oppref-cookie, og /start sender
-- den videre som query-parameter til /signup her. Pixelen setter i tillegg en
-- opak nettleser-referanse i __obref.
--
-- Kjeden vi må holde sammen:
--   registrering (refs plukkes)  →  firmaopprettelse (refs følger firmaet)
--   →  prøvestart (konvertering sendes med firmaets refs)
--
--   ad_click_refs      refs fanget ved registrering, per bruker. Egen tabell
--                      fordi public.users-raden ikke finnes ennå på det
--                      tidspunktet (den skrives først i POST /api/companies).
--   companies.ad_*     refs kopiert over på firmaet ved opprettelse, slik at
--                      konverteringen kan slås opp på ÉN rad senere — også
--                      hvis brukeren som registrerte seg forsvinner.
--   ad_conversions     idempotensjournal. OpenAI dedupliserer på
--                      pixel-ID + eventnavn + id og beholder den FØRSTE de
--                      mottar, men vi vil ikke sende samme konvertering på
--                      nytt ved hver webhook-retry — og vi vil kunne se hva
--                      som faktisk gikk ut.
--
-- Alt er additivt. Ingen av tabellene er tilgjengelige for app-brukere:
-- kun service-rollen (serverkoden) skriver og leser dem.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.ad_click_refs (
  user_id        UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  oppref         TEXT,
  obref          TEXT,
  first_touch_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.ad_click_refs ENABLE ROW LEVEL SECURITY;
-- Ingen policies: RLS med null policies = ingen tilgang for anon/authenticated.
-- Service-rollen går forbi RLS, og den er den eneste som trenger tilgang.

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS ad_oppref TEXT,
  ADD COLUMN IF NOT EXISTS ad_obref TEXT,
  ADD COLUMN IF NOT EXISTS ad_first_touch_at TIMESTAMPTZ;

-- Rask oppslag av «hvilke firmaer kom fra annonser».
CREATE INDEX IF NOT EXISTS companies_ad_oppref_idx
  ON public.companies (ad_oppref)
  WHERE ad_oppref IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.ad_conversions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider        TEXT NOT NULL DEFAULT 'openai',
  event_name      TEXT NOT NULL,
  -- Samme verdi som nettleseren sender som event-ID (for prøveperioder:
  -- Stripe-abonnementets id). Dedupliseringen hos OpenAI hviler på denne.
  event_id        TEXT NOT NULL,
  company_id      UUID REFERENCES public.companies(id) ON DELETE SET NULL,
  oppref          TEXT,
  obref           TEXT,
  response_status INTEGER,
  error           TEXT,
  sent_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, event_name, event_id)
);

ALTER TABLE public.ad_conversions ENABLE ROW LEVEL SECURITY;
-- Samme som over: ingen policies, kun service-rollen.

CREATE INDEX IF NOT EXISTS ad_conversions_company_idx
  ON public.ad_conversions (company_id, sent_at DESC);
