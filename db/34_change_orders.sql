-- Tilleggsarbeid / endringsordre (Fase 2).
-- Enkelt: et tillegg hører til et tilbud (offer) og har tittel + beskrivelse + ETT beløp
-- + bilder. Kunden godkjenner via offentlig lenke (samme mønster som tilbudsaksept).

CREATE TABLE IF NOT EXISTS public.change_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  offer_id UUID NOT NULL REFERENCES public.offers(id) ON DELETE CASCADE,
  project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  amount_nok NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (amount_nok >= 0),
  public_slug TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'sent', 'accepted', 'rejected')),
  sent_at TIMESTAMPTZ,
  customer_responded_at TIMESTAMPTZ,
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_change_orders_company ON public.change_orders(company_id);
CREATE INDEX IF NOT EXISTS idx_change_orders_offer ON public.change_orders(offer_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_change_orders_public_slug
  ON public.change_orders(public_slug) WHERE public_slug IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.change_order_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  change_order_id UUID NOT NULL REFERENCES public.change_orders(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_change_order_photos_co ON public.change_order_photos(change_order_id);

ALTER TABLE public.change_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.change_order_photos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS company_members_select_change_orders ON public.change_orders;
CREATE POLICY company_members_select_change_orders ON public.change_orders FOR SELECT
  USING (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));
DROP POLICY IF EXISTS company_members_insert_change_orders ON public.change_orders;
CREATE POLICY company_members_insert_change_orders ON public.change_orders FOR INSERT
  WITH CHECK (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));
DROP POLICY IF EXISTS company_members_update_change_orders ON public.change_orders;
CREATE POLICY company_members_update_change_orders ON public.change_orders FOR UPDATE
  USING (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()))
  WITH CHECK (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));
DROP POLICY IF EXISTS company_members_delete_change_orders ON public.change_orders;
CREATE POLICY company_members_delete_change_orders ON public.change_orders FOR DELETE
  USING (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));

DROP POLICY IF EXISTS company_members_select_change_order_photos ON public.change_order_photos;
CREATE POLICY company_members_select_change_order_photos ON public.change_order_photos FOR SELECT
  USING (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));
DROP POLICY IF EXISTS company_members_insert_change_order_photos ON public.change_order_photos;
CREATE POLICY company_members_insert_change_order_photos ON public.change_order_photos FOR INSERT
  WITH CHECK (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));
DROP POLICY IF EXISTS company_members_delete_change_order_photos ON public.change_order_photos;
CREATE POLICY company_members_delete_change_order_photos ON public.change_order_photos FOR DELETE
  USING (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));
