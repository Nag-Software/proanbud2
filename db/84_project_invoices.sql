-- 84_project_invoices.sql
-- Fakturering på prosjektnivå: en faktura bygges av et UTVALG fakturerbare linjer.
--
-- Bakgrunn: fakturaen ble tidligere opprettet i det tilbudet ble akseptert. Det treffer
-- ingen reell norsk praksis — på aksepttidspunktet er ingenting utført og ingen tillegg
-- finnes ennå. Håndverkere fakturerer etter utført arbeid, og tillegg kommer underveis.
--
-- Én modell dekker alle tre mønstrene:
--   * Sluttfaktura  — velg alt gjenstående
--   * A-konto       — velg en del av beløpet, gjenta utover i prosjektet
--   * Separat tillegg — velg kun tilleggslinjene
--
-- Dobbeltfakturering hindres ved at hver linje peker på KILDEN sin (tilbud eller
-- endringsordre). «Fakturert så langt» for en kilde = SUM(amount_nok) over linjer på
-- fakturaer som ikke er kansellert. Gjenstående = kildens sum minus det.
-- Safe to run repeatedly.

CREATE TABLE IF NOT EXISTS public.project_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  -- Kort intern referanse. Det ENDELIGE fakturanummeret settes av Fiken, som er
  -- betalingsmottaker og eier nummerserien — vi lager aldri vårt eget.
  reference TEXT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'queued', 'sent', 'paid', 'cancelled')),
  -- Fritekst til kunden, følger med fakturaen.
  message TEXT,
  -- Sum av linjene, EKS mva. Mva legges på av Fiken ut fra companies.vat_registered.
  amount_nok NUMERIC(14, 2) NOT NULL DEFAULT 0,
  due_days INT NOT NULL DEFAULT 14 CHECK (due_days BETWEEN 0 AND 365),
  issued_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.project_invoice_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL REFERENCES public.project_invoices(id) ON DELETE CASCADE,
  -- Hvor linja kommer fra. 'manual' er en fri linje uten kilde (f.eks. avrunding
  -- eller et påslag som ikke stammer fra tilbud/endringsordre).
  source_type TEXT NOT NULL CHECK (source_type IN ('offer', 'change_order', 'manual')),
  source_id UUID,
  description TEXT NOT NULL,
  quantity NUMERIC(14, 3) NOT NULL DEFAULT 1,
  unit TEXT,
  unit_price_nok NUMERIC(14, 2) NOT NULL DEFAULT 0,
  -- Speiler lib/tilbud/income-accounts.ts, så riktig konto følger med til Fiken.
  income_account_category TEXT
    CHECK (income_account_category IN ('vare_videresalg', 'vare_egenprodusert', 'tjeneste', 'annet')),
  amount_nok NUMERIC(14, 2) NOT NULL DEFAULT 0,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS project_invoices_project_idx
  ON public.project_invoices (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS project_invoices_company_idx
  ON public.project_invoices (company_id, status);
CREATE INDEX IF NOT EXISTS project_invoice_lines_invoice_idx
  ON public.project_invoice_lines (invoice_id);
-- Bærer «fakturert så langt»-oppslaget per kilde.
CREATE INDEX IF NOT EXISTS project_invoice_lines_source_idx
  ON public.project_invoice_lines (company_id, source_type, source_id);

ALTER TABLE public.project_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_invoice_lines ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_project_invoices') THEN
    CREATE TRIGGER set_updated_at_project_invoices
    BEFORE UPDATE ON public.project_invoices
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
  END IF;
END$$;

-- Tilgang: medlemmer av bedriften. Samme mønster som change_orders, men med
-- get_current_company_id() (db/80-konvensjonen: alltid subquery, aldri auth.uid() bart).
DROP POLICY IF EXISTS company_members_all_project_invoices ON public.project_invoices;
CREATE POLICY company_members_all_project_invoices ON public.project_invoices
  FOR ALL
  USING (company_id = (SELECT public.get_current_company_id()))
  WITH CHECK (company_id = (SELECT public.get_current_company_id()));

DROP POLICY IF EXISTS company_members_all_project_invoice_lines ON public.project_invoice_lines;
CREATE POLICY company_members_all_project_invoice_lines ON public.project_invoice_lines
  FOR ALL
  USING (company_id = (SELECT public.get_current_company_id()))
  WITH CHECK (company_id = (SELECT public.get_current_company_id()));

-- db/80 la den restriktive «aktiv bruker»-policyen på alle tabeller som fantes DA.
-- Nye tabeller må legge den på selv, ellers slipper deaktiverte kontoer inn.
DROP POLICY IF EXISTS active_authenticated_user ON public.project_invoices;
CREATE POLICY active_authenticated_user ON public.project_invoices
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.is_active_user()))
  WITH CHECK ((SELECT public.is_active_user()));

DROP POLICY IF EXISTS active_authenticated_user ON public.project_invoice_lines;
CREATE POLICY active_authenticated_user ON public.project_invoice_lines
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.is_active_user()))
  WITH CHECK ((SELECT public.is_active_user()));

COMMENT ON TABLE public.project_invoices IS
  'Faktura bygget av et utvalg fakturerbare linjer på et prosjekt. Fiken eier fakturanummer og utsending.';
COMMENT ON TABLE public.project_invoice_lines IS
  'Fakturalinjer med peker til kilden (tilbud/endringsordre), som er det som hindrer dobbeltfakturering.';
