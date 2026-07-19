-- ============================================================================
-- 74: Velkomstrabatt etter prøveperioden (80 % av første måned)
--
-- Hver bedrift som har vært gjennom prøveperioden får sin EGEN Stripe-kupong +
-- kampanjekode (percent_off 80, duration = once, max_redemptions = 1, låst til
-- bedriftens Stripe-kunde). Koden lagres her slik at:
--   • e-postsekvensen kan gjenbruke samme kode ved neste påminnelse
--     (idempotent — vi lager aldri en ny kode til samme bedrift), og
--   • betalingssiden/checkout kan vise og bruke den automatisk.
--
-- welcome_discount_applied_at settes når koden faktisk er festet på et levende
-- abonnement (kortfri prøve som konverterer) — ikke når koden ble laget.
-- ============================================================================

alter table public.company_billing
  add column if not exists welcome_promo_code text,
  add column if not exists welcome_promo_id text,
  add column if not exists welcome_discount_applied_at timestamptz;

comment on column public.company_billing.welcome_promo_code is
  'Personlig Stripe-kampanjekode (80 % av første måned) — engangsbruk, låst til bedriftens kunde.';
comment on column public.company_billing.welcome_promo_id is
  'Stripe promotion_code-ID for welcome_promo_code (brukes ved checkout/abonnementsoppdatering).';
comment on column public.company_billing.welcome_discount_applied_at is
  'Når velkomstrabatten ble festet på abonnementet. Null = koden finnes, men er ikke tatt i bruk.';
