-- ==========================================
-- SUPPLIER PRICE FILES
-- Upload and manage price lists from building supply stores.
-- Used by the AI agent when generating offers.
-- ==========================================

CREATE TABLE IF NOT EXISTS public.supplier_price_files (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id        UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  supplier_name     TEXT NOT NULL,
  original_filename TEXT NOT NULL DEFAULT '',
  row_count         INTEGER NOT NULL DEFAULT 0,
  status            TEXT NOT NULL DEFAULT 'ready' CHECK (status IN ('ready', 'error')),
  created_by        UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.supplier_price_rows (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  file_id             UUID NOT NULL REFERENCES public.supplier_price_files(id) ON DELETE CASCADE,
  company_id          UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  product             TEXT,
  nobb                TEXT,
  ean                 TEXT,
  category            TEXT,
  product_group_code  TEXT,
  unit                TEXT,
  list_price          NUMERIC,
  min_price           NUMERIC,
  discount_percent    NUMERIC,
  net_price           NUMERIC,
  supplier_sku        TEXT,
  created_at          TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_spf_company_id ON public.supplier_price_files(company_id);
CREATE INDEX IF NOT EXISTS idx_spr_company_id ON public.supplier_price_rows(company_id);
CREATE INDEX IF NOT EXISTS idx_spr_file_id    ON public.supplier_price_rows(file_id);
CREATE INDEX IF NOT EXISTS idx_spr_product_group_code ON public.supplier_price_rows(product_group_code);
CREATE INDEX IF NOT EXISTS idx_spr_product_fts
  ON public.supplier_price_rows
  USING gin(to_tsvector('simple', coalesce(product, '')));

-- RLS
ALTER TABLE public.supplier_price_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_price_rows  ENABLE ROW LEVEL SECURITY;

-- supplier_price_files policies
CREATE POLICY "company_members_select_price_files"
  ON public.supplier_price_files FOR SELECT
  USING (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));

CREATE POLICY "company_members_insert_price_files"
  ON public.supplier_price_files FOR INSERT
  WITH CHECK (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));

CREATE POLICY "company_members_delete_price_files"
  ON public.supplier_price_files FOR DELETE
  USING (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));

-- supplier_price_rows policies
CREATE POLICY "company_members_select_price_rows"
  ON public.supplier_price_rows FOR SELECT
  USING (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));

CREATE POLICY "company_members_insert_price_rows"
  ON public.supplier_price_rows FOR INSERT
  WITH CHECK (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));

CREATE POLICY "company_members_delete_price_rows"
  ON public.supplier_price_rows FOR DELETE
  USING (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));
 