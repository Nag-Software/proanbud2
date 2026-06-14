-- ==========================================
-- HMS / Avvik — enkel versjon
-- ==========================================

CREATE SEQUENCE IF NOT EXISTS public.deviation_reference_seq START 1;

-- Fjern komplekse tabeller fra tidligere versjon
DROP TABLE IF EXISTS public.safety_round_items CASCADE;
DROP TABLE IF EXISTS public.safety_rounds CASCADE;
DROP TABLE IF EXISTS public.sja_analyses CASCADE;
DROP TABLE IF EXISTS public.project_sha_plans CASCADE;
DROP TABLE IF EXISTS public.hms_risk_items CASCADE;
DROP TABLE IF EXISTS public.hms_risk_assessments CASCADE;
DROP TABLE IF EXISTS public.hms_revisions CASCADE;
DROP TABLE IF EXISTS public.hms_routines CASCADE;
DROP TABLE IF EXISTS public.hms_handbook_sections CASCADE;
DROP TABLE IF EXISTS public.hms_goals CASCADE;
DROP TABLE IF EXISTS public.deviation_activity CASCADE;
DROP TABLE IF EXISTS public.deviation_actions CASCADE;

-- ==========================================
-- AVVIK
-- ==========================================

CREATE TABLE IF NOT EXISTS public.deviations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  reference_number TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('ruh', 'hms', 'ks', 'forbedring')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  location_text TEXT,
  reported_by UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  follow_up_notes TEXT,
  closed_at TIMESTAMPTZ,
  closed_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (company_id, reference_number)
);

-- Migrer eksisterende avvik-tabell hvis den finnes fra gammel versjon
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'deviations'
  ) THEN
    UPDATE public.deviations SET status = 'closed' WHERE status = 'closed';
    UPDATE public.deviations SET status = 'open' WHERE status IS DISTINCT FROM 'closed';

    ALTER TABLE public.deviations DROP COLUMN IF EXISTS severity;
    ALTER TABLE public.deviations DROP COLUMN IF EXISTS assigned_to;
    ALTER TABLE public.deviations DROP COLUMN IF EXISTS due_date;
    ALTER TABLE public.deviations DROP COLUMN IF EXISTS immediate_action;
    ALTER TABLE public.deviations DROP COLUMN IF EXISTS root_cause;
    ALTER TABLE public.deviations DROP COLUMN IF EXISTS corrective_action;
    ALTER TABLE public.deviations DROP COLUMN IF EXISTS occurred_at;
    ALTER TABLE public.deviations ADD COLUMN IF NOT EXISTS follow_up_notes TEXT;

    ALTER TABLE public.deviations DROP CONSTRAINT IF EXISTS deviations_status_check;
    ALTER TABLE public.deviations ADD CONSTRAINT deviations_status_check
      CHECK (status IN ('open', 'closed'));
    ALTER TABLE public.deviations ALTER COLUMN status SET DEFAULT 'open';

    ALTER TABLE public.deviations ALTER COLUMN description SET NOT NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.deviation_attachments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  deviation_id UUID NOT NULL REFERENCES public.deviations(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  uploaded_by UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  file_name TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  mime_type TEXT,
  size_bytes INTEGER,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ==========================================
-- BEDRIFTS-HMS (én enkel håndbok per bedrift)
-- ==========================================

CREATE TABLE IF NOT EXISTS public.company_hms (
  company_id UUID PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  handbook_content TEXT NOT NULL DEFAULT '',
  updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ==========================================
-- HELPERS
-- ==========================================

CREATE OR REPLACE FUNCTION public.is_project_manager(p_project_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.project_members pm
    WHERE pm.project_id = p_project_id
      AND pm.user_id = auth.uid()
      AND pm.access_level = 'manager'
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.can_manage_deviations(p_project_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  IF NOT public.has_project_access(p_project_id) THEN
    RETURN false;
  END IF;

  IF public.is_company_manager_or_admin() THEN
    RETURN true;
  END IF;

  RETURN public.is_project_manager(p_project_id);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.generate_deviation_reference(p_company_id UUID)
RETURNS TEXT AS $$
DECLARE
  year_part TEXT;
  seq_num INTEGER;
BEGIN
  year_part := to_char(now(), 'YYYY');
  seq_num := nextval('public.deviation_reference_seq');
  RETURN 'AVV-' || year_part || '-' || lpad(seq_num::text, 4, '0');
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.set_deviation_reference()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.reference_number IS NULL OR NEW.reference_number = '' THEN
    NEW.reference_number := public.generate_deviation_reference(NEW.company_id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_deviation_reference_trigger ON public.deviations;
CREATE TRIGGER set_deviation_reference_trigger
  BEFORE INSERT ON public.deviations
  FOR EACH ROW EXECUTE FUNCTION public.set_deviation_reference();

DROP TRIGGER IF EXISTS log_deviation_activity_on_insert_trigger ON public.deviations;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_deviations') THEN
    CREATE TRIGGER set_updated_at_deviations
      BEFORE UPDATE ON public.deviations
      FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_company_hms') THEN
    CREATE TRIGGER set_updated_at_company_hms
      BEFORE UPDATE ON public.company_hms
      FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
  END IF;
END$$;

-- ==========================================
-- INDEXES
-- ==========================================

CREATE INDEX IF NOT EXISTS idx_deviations_company_status ON public.deviations (company_id, status);
CREATE INDEX IF NOT EXISTS idx_deviations_project_status ON public.deviations (project_id, status);
CREATE INDEX IF NOT EXISTS idx_deviations_company_created ON public.deviations (company_id, created_at DESC);

-- ==========================================
-- RLS
-- ==========================================

ALTER TABLE public.deviations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deviation_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_hms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS deviations_select ON public.deviations;
CREATE POLICY deviations_select ON public.deviations FOR SELECT TO authenticated
USING (
  company_id = public.get_current_company_id()
  AND (
    public.is_company_manager_or_admin()
    OR public.has_project_access(project_id)
  )
);

DROP POLICY IF EXISTS deviations_insert ON public.deviations;
CREATE POLICY deviations_insert ON public.deviations FOR INSERT TO authenticated
WITH CHECK (
  company_id = public.get_current_company_id()
  AND public.has_project_access(project_id)
  AND reported_by = auth.uid()
);

DROP POLICY IF EXISTS deviations_update ON public.deviations;
CREATE POLICY deviations_update ON public.deviations FOR UPDATE TO authenticated
USING (
  company_id = public.get_current_company_id()
  AND public.can_manage_deviations(project_id)
)
WITH CHECK (company_id = public.get_current_company_id());

DROP POLICY IF EXISTS deviation_attachments_select ON public.deviation_attachments;
CREATE POLICY deviation_attachments_select ON public.deviation_attachments FOR SELECT TO authenticated
USING (company_id = public.get_current_company_id());

DROP POLICY IF EXISTS deviation_attachments_insert ON public.deviation_attachments;
CREATE POLICY deviation_attachments_insert ON public.deviation_attachments FOR INSERT TO authenticated
WITH CHECK (
  company_id = public.get_current_company_id()
  AND uploaded_by = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.deviations d
    WHERE d.id = deviation_id
      AND d.company_id = public.get_current_company_id()
      AND public.has_project_access(d.project_id)
  )
);

DROP POLICY IF EXISTS company_hms_select ON public.company_hms;
CREATE POLICY company_hms_select ON public.company_hms FOR SELECT TO authenticated
USING (company_id = public.get_current_company_id());

DROP POLICY IF EXISTS company_hms_admin ON public.company_hms;
CREATE POLICY company_hms_admin ON public.company_hms FOR ALL TO authenticated
USING (company_id = public.get_current_company_id() AND public.is_company_admin())
WITH CHECK (company_id = public.get_current_company_id() AND public.is_company_admin());

-- ==========================================
-- STORAGE
-- ==========================================

DO $$
BEGIN
  INSERT INTO storage.buckets (id, name, public)
  VALUES ('hms_avvik', 'hms_avvik', false)
  ON CONFLICT (id) DO NOTHING;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Create hms_avvik bucket manually if needed.';
END $$;

DROP POLICY IF EXISTS hms_avvik_select ON storage.objects;
CREATE POLICY hms_avvik_select ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'hms_avvik');

DROP POLICY IF EXISTS hms_avvik_insert ON storage.objects;
CREATE POLICY hms_avvik_insert ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'hms_avvik');

DROP POLICY IF EXISTS hms_avvik_delete ON storage.objects;
CREATE POLICY hms_avvik_delete ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'hms_avvik' AND owner = auth.uid());
