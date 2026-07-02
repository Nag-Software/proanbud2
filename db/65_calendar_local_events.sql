-- ============================================================================
-- 65_calendar_local_events.sql
-- ----------------------------------------------------------------------------
-- Innebygd Proanbud-kalender (alle planer) + kobling til eksterne kalendere.
--
--   calendar_events      — lokale avtaler, delt på bedriftsnivå (alle i firmaet
--                          ser samme kalender), valgfri prosjektkobling.
--   calendar_event_links — hvilke lokale avtaler som er kopiert til en brukers
--                          Google/Outlook-kalender (gratis tilkobling).
--                          Per bruker fordi calendar_integrations er per bruker:
--                          to kolleger kan ha hver sin kopi i hver sin Google-
--                          konto. Brukes også til å filtrere bort duplikater
--                          når eksterne avtaler hentes inn til visning.
--
-- Tenant model mirrors kjørebok: RLS er bedriftsgrensen; finere regler (hvem
-- kan redigere hva) håndheves i server-rutene.
--
-- Idempotent: safe to re-run.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- calendar_events
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.calendar_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id  UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  created_by  UUID REFERENCES public.users(id) ON DELETE SET NULL,
  title       TEXT NOT NULL,
  description TEXT,
  starts_at   TIMESTAMPTZ NOT NULL,
  ends_at     TIMESTAMPTZ NOT NULL,
  color       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT calendar_events_time_order CHECK (ends_at >= starts_at)
);

CREATE INDEX IF NOT EXISTS idx_calendar_events_company_start
  ON public.calendar_events(company_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_calendar_events_project
  ON public.calendar_events(project_id) WHERE project_id IS NOT NULL;

ALTER TABLE public.calendar_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS company_members_select_calendar_events ON public.calendar_events;
CREATE POLICY company_members_select_calendar_events
  ON public.calendar_events FOR SELECT
  USING (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));

DROP POLICY IF EXISTS company_members_insert_calendar_events ON public.calendar_events;
CREATE POLICY company_members_insert_calendar_events
  ON public.calendar_events FOR INSERT
  WITH CHECK (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));

DROP POLICY IF EXISTS company_members_update_calendar_events ON public.calendar_events;
CREATE POLICY company_members_update_calendar_events
  ON public.calendar_events FOR UPDATE
  USING (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()))
  WITH CHECK (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));

DROP POLICY IF EXISTS company_members_delete_calendar_events ON public.calendar_events;
CREATE POLICY company_members_delete_calendar_events
  ON public.calendar_events FOR DELETE
  USING (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));

-- ---------------------------------------------------------------------------
-- calendar_event_links
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.calendar_event_links (
  event_id    UUID NOT NULL REFERENCES public.calendar_events(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider    TEXT NOT NULL CHECK (provider IN ('google', 'microsoft')),
  external_id TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, user_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_calendar_event_links_user
  ON public.calendar_event_links(user_id, provider);

ALTER TABLE public.calendar_event_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS owner_manage_calendar_event_links ON public.calendar_event_links;
CREATE POLICY owner_manage_calendar_event_links
  ON public.calendar_event_links FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
