-- 113_price_cohort.sql
-- Prislisten et levende abonnement står på, lagret på company_billing.
--
-- Prisøkningen 8. oktober 2026 ga to prislister (gammel/«legacy» med 12 mnd
-- prislås, og dagens/«current»). Kohorten ble først utledet av bedriftens
-- opprettelsesdato, så av status, og til slutt av grunnprisens ID i Stripe —
-- fordi bare Stripe vet hva abonnementet faktisk koster (en gammel bedrift som
-- lot prøven utløpe og tegnet nytt abonnement, står på dagens pris).
--
-- Stripe-oppslaget kostet ett API-kall per visning av betalingssiden. Nå
-- skriver billing-synken (webhook, reconcile, checkout, planbytte) kohorten
-- hit når den leser abonnementet, og alt annet leser kolonnen. NULL betyr
-- «ikke synket ennå» — da faller koden tilbake på Stripe-oppslaget og fyller
-- kolonnen i samme slengen, så raden selvhelbreder ved første bruk.
--
-- Ingen backfill her: verdien kan ikke utledes fra databasen alene, og en
-- feil «legacy» ville gitt gamle pris-ID-er på et nytt abonnement.
--
-- Additiv: kan kjøres i prod før koden deployes. Safe to run repeatedly.

ALTER TABLE public.company_billing
  ADD COLUMN IF NOT EXISTS price_cohort TEXT
    CHECK (price_cohort IN ('current', 'legacy'));

COMMENT ON COLUMN public.company_billing.price_cohort IS
  'Prislisten grunnplanen i Stripe står på (current/legacy). NULL = ikke synket ennå; koden slår opp i Stripe og fyller inn.';
