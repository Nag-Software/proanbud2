-- 82_company_vat_registered.sql
-- Om bedriften er registrert i Merverdiavgiftsregisteret.
--
-- Dette avgjør reell økonomi, ikke bare visning:
--   * Tilbud/faktura til kunde: en bedrift som IKKE er mva-registrert har verken rett
--     eller plikt til å legge på mva. Å vise «Mva (25 %)» da er direkte feil.
--   * Fiken: linjenes vatType må være OUTSIDE («utenfor merverdiavgiftsloven») i stedet
--     for HIGH. IKKE «NONE» — Fiken avviser det med HTTP 400: «VAT charged when the
--     company is not VAT registered. The only VAT type accepted is OUTSIDE.» NONE betyr
--     0 % mva på et avgiftspliktig salg, og forutsetter at bedriften ER registrert.
--   * Inntektskonto følger samme skille: 30xx («høy mva-sats») for registrerte,
--     32xx («unntatt for mva») for ikke-registrerte. Se lib/tilbud/income-accounts.ts.
--
-- Default TRUE er bevisst: dagens kode legger ALLTID på 25 %, så TRUE bevarer
-- eksisterende oppførsel for alle bestående bedrifter. Ingen tilbud endrer seg av
-- denne migrasjonen alene — først når en bruker aktivt velger «ikke mva-registrert».
--
-- Terskelen i Norge er 50 000 kr avgiftspliktig omsetning siste 12 mnd.
-- Safe to run repeatedly.

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS vat_registered BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN public.companies.vat_registered IS
  'Registrert i Merverdiavgiftsregisteret. Styrer mva på tilbud/faktura og vatType mot Fiken (HIGH vs NONE).';
