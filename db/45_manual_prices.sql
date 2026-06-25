-- ==========================================
-- MANUAL PRICES
-- Let an admin add individual prices by hand (product, unit price, free-text
-- supplier) on top of uploaded supplier price files. Manual entries are grouped
-- into a per-supplier "manual" price file so they flow into the price search and
-- the AI offer generator exactly like uploaded rows — with correct supplier
-- attribution and no changes needed in the consumers.
-- ==========================================

-- Distinguish manually-created price files from uploaded CSV files.
ALTER TABLE public.supplier_price_files
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'upload';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'supplier_price_files_source_check'
  ) THEN
    ALTER TABLE public.supplier_price_files
      ADD CONSTRAINT supplier_price_files_source_check
      CHECK (source IN ('upload', 'manual'));
  END IF;
END $$;

-- One manual "file" per supplier per company (case-insensitive) so repeated
-- manual entries for the same supplier accumulate inside a single card.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_spf_manual_supplier
  ON public.supplier_price_files (company_id, lower(supplier_name))
  WHERE source = 'manual';

-- Manual prices need UPDATE (row_count bookkeeping + editing rows). The original
-- schema (db/12) only granted SELECT / INSERT / DELETE.
DROP POLICY IF EXISTS "company_members_update_price_files" ON public.supplier_price_files;
CREATE POLICY "company_members_update_price_files"
  ON public.supplier_price_files FOR UPDATE
  USING (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()))
  WITH CHECK (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "company_members_update_price_rows" ON public.supplier_price_rows;
CREATE POLICY "company_members_update_price_rows"
  ON public.supplier_price_rows FOR UPDATE
  USING (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()))
  WITH CHECK (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));
