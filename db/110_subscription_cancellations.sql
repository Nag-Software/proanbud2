-- 110_subscription_cancellations.sql
-- Hvorfor kunder avslutter abonnementet.
--
--   * Én rad per gang en admin fullfører «Avslutt abonnement»-dialogen på
--     Innstillinger → Betaling. Grunnen er obligatorisk (én grunn), og noen
--     grunner krever utdypning i fritekst (detail).
--
--   * outcome = 'canceled'          → abonnementet avsluttes ved periodeslutt.
--     outcome = 'discount_accepted' → kunden valgte «For dyrt» og tok imot
--                                     50 % av neste måned i stedet for å slutte.
--
--   * resumed_at stemples når kunden gjenopptar abonnementet i appen.
--
-- Vises på /sjefen/oppsigelser. Skrives og leses kun av serveren med service
-- role — RLS er på uten policies (deny-all), som error_logs (db/50).
--
-- company_id/user_id settes til NULL når firmaet/brukeren slettes, så raden
-- (med firmanavnet som øyeblikksbilde) overlever en kontosletting.
--
-- Additiv: kan kjøres i prod før koden deployes. Safe to run repeatedly.

CREATE TABLE IF NOT EXISTS public.subscription_cancellations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL,
  company_name TEXT,
  user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  -- Nøkkel fra lib/billing/cancellation-reasons.ts. Fritekst, så nye grunner
  -- ikke krever migrasjon.
  reason TEXT NOT NULL,
  -- Utdypning for grunner som krever det (hva mangler, hvilket system, …).
  detail TEXT,
  outcome TEXT NOT NULL DEFAULT 'canceled'
    CHECK (outcome IN ('canceled', 'discount_accepted')),
  -- Øyeblikksbilde av abonnementet da svaret ble gitt.
  plan_key TEXT,
  billing_interval TEXT,
  status_at_cancel TEXT,
  subscribed_since TIMESTAMPTZ,
  -- Når tilgangen opphører (kun outcome = 'canceled').
  cancel_at TIMESTAMPTZ,
  resumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subscription_cancellations_created
  ON public.subscription_cancellations (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_subscription_cancellations_company
  ON public.subscription_cancellations (company_id, created_at DESC);

ALTER TABLE public.subscription_cancellations ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_subscription_cancellations_reason
  ON public.subscription_cancellations (reason);
