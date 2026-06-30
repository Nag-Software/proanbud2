-- Auto-close safety net for forgotten time sessions. A geofence/manual session
-- is never stopped just because the worker leaves the site (they may be fetching
-- materials for the same project). Instead a forgotten open session is closed
-- automatically — at the company's shift end and/or after a max number of hours —
-- and flagged for manager approval. Per-company settings live here.

CREATE TABLE IF NOT EXISTS public.company_tracking_settings (
  company_id          UUID PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  auto_close_enabled  BOOLEAN NOT NULL DEFAULT true,
  default_shift_end   TIME,                       -- e.g. 15:00 (Europe/Oslo); null = no shift-end trigger
  max_session_hours   INTEGER NOT NULL DEFAULT 10,
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.company_tracking_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS company_tracking_settings_select ON public.company_tracking_settings;
CREATE POLICY company_tracking_settings_select ON public.company_tracking_settings
  FOR SELECT
  USING (company_id = public.get_current_company_id());

DROP POLICY IF EXISTS company_tracking_settings_write ON public.company_tracking_settings;
CREATE POLICY company_tracking_settings_write ON public.company_tracking_settings
  FOR ALL
  USING (company_id = public.get_current_company_id() AND public.is_company_manager_or_admin())
  WITH CHECK (company_id = public.get_current_company_id() AND public.is_company_manager_or_admin());

-- Marks entries the safety net closed (uncertain end time → manager should check).
ALTER TABLE public.time_entries
  ADD COLUMN IF NOT EXISTS auto_closed BOOLEAN NOT NULL DEFAULT false;
