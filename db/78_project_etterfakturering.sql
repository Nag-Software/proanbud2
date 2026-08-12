-- Etterfakturering / ekstrajobber på prosjektnivå.
-- Gjenbruker change_orders-tabellen, men lar `offer_id` være tom når jobben
-- opprettes direkte fra prosjektet i stedet for fra et konkret tilbud.

ALTER TABLE public.change_orders
  ALTER COLUMN offer_id DROP NOT NULL;

ALTER TABLE public.change_orders
  ADD COLUMN IF NOT EXISTS billing_type TEXT NOT NULL DEFAULT 'fixed'
    CHECK (billing_type IN ('fixed', 'hourly')),
  ADD COLUMN IF NOT EXISTS hourly_rate_nok NUMERIC(14, 2),
  ADD COLUMN IF NOT EXISTS estimated_hours NUMERIC(10, 2);

CREATE INDEX IF NOT EXISTS idx_change_orders_project_created
  ON public.change_orders(project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_change_orders_project_status
  ON public.change_orders(project_id, status);