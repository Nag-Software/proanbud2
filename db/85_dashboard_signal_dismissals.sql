-- 85_dashboard_signal_dismissals.sql
-- «Skjul dette» på dashbordets «Venter på deg».
--
-- Per BRUKER, ikke per bedrift: dashbordet er personlig, og det ene teammedlemmet skal
-- ikke kunne skjule et varsel for de andre.
--
-- Skjuling er bevisst MIDLERTIDIG (se DASHBOARD_DISMISS_DAYS i
-- lib/dashboard/waiting-signals.ts). Et permanent «skjul» på f.eks. forfalt faktura
-- ville gjort brukeren varig blind for penger de ikke har fått — «ikke nå» er en ærlig
-- handling, «aldri mer» er en felle.
-- Safe to run repeatedly.

CREATE TABLE IF NOT EXISTS public.dashboard_signal_dismissals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  -- Stabil nøkkel for signalet, f.eks. 'overdue-invoices' eller 'fiken-setup'.
  signal_key TEXT NOT NULL,
  dismissed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, signal_key)
);

CREATE INDEX IF NOT EXISTS dashboard_signal_dismissals_user_idx
  ON public.dashboard_signal_dismissals (user_id, dismissed_at DESC);

ALTER TABLE public.dashboard_signal_dismissals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS own_dismissals ON public.dashboard_signal_dismissals;
CREATE POLICY own_dismissals ON public.dashboard_signal_dismissals
  FOR ALL
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

-- db/80 la den restriktive «aktiv bruker»-policyen kun på tabeller som fantes da.
DROP POLICY IF EXISTS active_authenticated_user ON public.dashboard_signal_dismissals;
CREATE POLICY active_authenticated_user ON public.dashboard_signal_dismissals
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.is_active_user()))
  WITH CHECK ((SELECT public.is_active_user()));

COMMENT ON TABLE public.dashboard_signal_dismissals IS
  'Midlertidig skjulte «Venter på deg»-signaler, per bruker. Utløper etter noen dager.';
