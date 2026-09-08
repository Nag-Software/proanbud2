-- 87_regnskap_felles_vokabular.sql
--
-- Én regnskapsopplevelse: Fiken og Tripletex bak samme knapper.
--
-- To ting skjer her:
--   1) scope_config får ETT vokabular. Fiken skrev `contacts` og
--      `sendInvoiceFromFiken`; Tripletex skrev `customers` og hadde ingen
--      send-bryter. Koden leser fortsatt begge (lib/regnskap/scopes.ts) — denne
--      migrasjonen etterfyller bare de kanoniske nøklene på eksisterende rader,
--      slik at UI-et viser riktig tilstand fra første render.
--   2) tripletex_connections får samme betalingsmarkør som Fiken allerede har.
--      Tripletex har webhook for betalt faktura, men den krever manuelt oppsett
--      hos kunden — uten polling ser en bedrift som ikke har satt den opp aldri
--      at en faktura er betalt.
--
-- MERK: entity_type i external_entity_links røres IKKE. Fiken skriver fortsatt
-- "contact" der Tripletex skriver "customer", og adapterne oversetter. Å bytte
-- verdiene her ville mistet dedupe-nøkkelen midt i drift og laget dubletter i
-- kundens regnskap.
--
-- Trygg å kjøre flere ganger.

-- 1a) Fiken: contacts → customers, sendInvoiceFromFiken → sendInvoiceFromAccounting.
--     De gamle nøklene beholdes, slik at en rullback til forrige release ikke
--     plutselig ser et tomt synkomfang.
UPDATE public.fiken_connections
SET scope_config = scope_config
  || jsonb_build_object('customers', COALESCE(scope_config -> 'customers', scope_config -> 'contacts', 'true'::jsonb))
  || jsonb_build_object(
       'sendInvoiceFromAccounting',
       COALESCE(scope_config -> 'sendInvoiceFromAccounting', scope_config -> 'sendInvoiceFromFiken', 'true'::jsonb)
     )
WHERE scope_config IS NOT NULL
  AND NOT (scope_config ? 'customers' AND scope_config ? 'sendInvoiceFromAccounting');

-- 1b) Tripletex: legg til send-bryteren og dokumentnøkkelen med samme navn som Fiken.
--     Standard true på sending — regnskapssystemet eier fakturanummer og utsending.
UPDATE public.tripletex_connections
SET scope_config = scope_config
  || jsonb_build_object(
       'sendInvoiceFromAccounting',
       COALESCE(scope_config -> 'sendInvoiceFromAccounting', 'true'::jsonb)
     )
  || jsonb_build_object('contacts', COALESCE(scope_config -> 'contacts', scope_config -> 'customers', 'true'::jsonb))
WHERE scope_config IS NOT NULL
  AND NOT scope_config ? 'sendInvoiceFromAccounting';

-- 2) Betalingsmarkør for Tripletex-polling. Dato-granularitet holder: GET /invoice
--    filtrerer på fakturadato (til-dato ekskluderende), ikke på betalingstidspunkt.
ALTER TABLE public.tripletex_connections
  ADD COLUMN IF NOT EXISTS last_payment_poll_date DATE;

COMMENT ON COLUMN public.tripletex_connections.last_payment_poll_date IS
  'Markør for poll_payments-jobben. Settes 30 dager tilbake i tid ved hver kjøring fordi vinduet filtrerer på fakturadato, ikke betalingsdato.';
