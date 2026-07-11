-- ==========================================
-- CHUNKED PRICE FILE UPLOADS
-- Store prisfiler (f.eks. EFO/NELFO-kataloger fra VVS-/elektrogrossister med
-- ~100 000 varer) lastes opp i flere requests for å holde hver request under
-- serverless-grensen på ~4,5 MB. Fila står i status 'uploading' til siste bit
-- er inne; KI-tilbud og prissøk leser kun filer med status 'ready'.
-- ==========================================

ALTER TABLE public.supplier_price_files
  DROP CONSTRAINT IF EXISTS supplier_price_files_status_check;

ALTER TABLE public.supplier_price_files
  ADD CONSTRAINT supplier_price_files_status_check
  CHECK (status IN ('ready', 'error', 'uploading'));
