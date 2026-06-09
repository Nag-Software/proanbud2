-- 14_offer_activity.sql
-- Aktivitetslogg for tilbud (hendelser-fanen).

CREATE TABLE IF NOT EXISTS public.offer_activity (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  offer_id UUID NOT NULL REFERENCES public.offers(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_offer_activity_offer_id ON public.offer_activity(offer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_offer_activity_company_id ON public.offer_activity(company_id, created_at DESC);

ALTER TABLE public.offer_activity ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS view_offer_activity ON public.offer_activity;
DROP POLICY IF EXISTS insert_offer_activity ON public.offer_activity;

CREATE POLICY view_offer_activity
ON public.offer_activity
FOR SELECT
USING (
  company_id = public.get_current_company_id()
  AND EXISTS (
    SELECT 1
    FROM public.offers o
    WHERE o.id = offer_activity.offer_id
      AND o.company_id = public.get_current_company_id()
      AND (
        o.project_id IS NULL
        OR public.has_project_access(o.project_id)
      )
  )
);

CREATE POLICY insert_offer_activity
ON public.offer_activity
FOR INSERT
WITH CHECK (
  company_id = public.get_current_company_id()
  AND EXISTS (
    SELECT 1
    FROM public.offers o
    WHERE o.id = offer_activity.offer_id
      AND o.company_id = public.get_current_company_id()
  )
);
