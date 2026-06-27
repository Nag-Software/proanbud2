-- Customer notes field (CRM-lite)

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS notes TEXT;
