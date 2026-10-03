-- 109_offer_tracking_notifications.sql
-- Firmaet skal se om kunden har åpnet tilbudet, og få beskjed i bjella.
--
--   * offers.email_* — Resend-id for tilbuds-e-posten og tidspunkt for «levert»
--     og «kom ikke frem». Stemples av /api/webhooks/resend. «Åpnet» er fortsatt
--     customer_viewed_at (db/15): besøk på /tilbudsvisning, ikke en sporingspiksel.
--
--   * company_notifications — varsler til firmaet i bjella (kunden åpnet tilbudet,
--     e-posten kom ikke frem). Skrives kun av serveren med service role; klienten
--     kan lese og markere som lest. Lesestatus er per firma, som for meldinger.
--
-- Additiv: kan kjøres i prod før koden deployes. Safe to run repeatedly.

ALTER TABLE public.offers
  ADD COLUMN IF NOT EXISTS email_provider_id TEXT,
  ADD COLUMN IF NOT EXISTS email_delivered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS email_bounced_at TIMESTAMPTZ;

-- Webhooken slår opp tilbudet på Resend-id for hver hendelse.
CREATE INDEX IF NOT EXISTS idx_offers_email_provider_id
  ON public.offers (email_provider_id)
  WHERE email_provider_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.company_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  -- 'offer_viewed' | 'offer_email_bounced'. Fritekst, så nye typer ikke krever migrasjon.
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  -- Intern sti varselet åpner, f.eks. /tilbud/<id>.
  href TEXT,
  offer_id UUID REFERENCES public.offers(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_company_notifications_company_created
  ON public.company_notifications (company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_company_notifications_offer
  ON public.company_notifications (offer_id)
  WHERE offer_id IS NOT NULL;

ALTER TABLE public.company_notifications ENABLE ROW LEVEL SECURITY;

-- Kun admin/leder ser varslene (arbeidere jobber ikke med tilbud), og bare for
-- tilbud de har tilgang til — samme prosjektvilkår som view_offer_activity.
DROP POLICY IF EXISTS company_notifications_select ON public.company_notifications;
CREATE POLICY company_notifications_select ON public.company_notifications
  FOR SELECT TO authenticated
  USING (
    company_id = (SELECT public.get_current_company_id())
    AND (SELECT public.is_company_manager_or_admin())
    AND (
      offer_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM public.offers o
        WHERE o.id = company_notifications.offer_id
          AND o.company_id = (SELECT public.get_current_company_id())
          AND (o.project_id IS NULL OR public.has_project_access(o.project_id))
      )
    )
  );

DROP POLICY IF EXISTS company_notifications_mark_read ON public.company_notifications;
CREATE POLICY company_notifications_mark_read ON public.company_notifications
  FOR UPDATE TO authenticated
  USING (
    company_id = (SELECT public.get_current_company_id())
    AND (SELECT public.is_company_manager_or_admin())
  )
  WITH CHECK (company_id = (SELECT public.get_current_company_id()));

DROP POLICY IF EXISTS active_authenticated_user ON public.company_notifications;
CREATE POLICY active_authenticated_user ON public.company_notifications
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.is_active_user()))
  WITH CHECK ((SELECT public.is_active_user()));

-- Klienten får lese og sette read_at — ingenting annet. Innsetting og sletting
-- går via service role.
REVOKE ALL ON public.company_notifications FROM anon, authenticated;
GRANT SELECT ON public.company_notifications TO authenticated;
GRANT UPDATE (read_at) ON public.company_notifications TO authenticated;

COMMENT ON TABLE public.company_notifications IS
  'Varsler til firmaet i bjella (kunde åpnet tilbud, tilbuds-e-post kom ikke frem). Skrives kun av serveren.';

-- Bjella oppdateres uten sidelast.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'company_notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.company_notifications;
  END IF;
END $$;
