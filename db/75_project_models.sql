-- ============================================================================
-- 75_project_models.sql
-- ----------------------------------------------------------------------------
-- 3D-modell (ProAnbud CAD) per prosjekt.
--
--   project_models           — én rad per modell. Hele bygningsmodellen ligger
--                              som JSONB i `data` (se lib/cad/schema.ts). Ett
--                              dokument = én atomisk lagring; CAD-modeller leses
--                              og skrives alltid i sin helhet, så normalisering
--                              til vegg-/åpningstabeller ville bare gitt
--                              N+1-lesing uten gevinst.
--   project_model_versions   — udelelig historikk. Hver lagring skriver forrige
--                              revisjon hit, slik at «angre» overlever refresh
--                              og at KI-generering aldri kan slette manuelt
--                              arbeid uforvarende.
--   project_model_references — bilder kunden lastet opp (i ny-prosjekt-veiviseren
--                              eller på modellfanen) som KI-en bruker som
--                              grunnlag for å generere modellen.
--
-- Samtidighet: `revision` er optimistisk lås. Klienten sender revisjonen den
-- lastet; server-actionen skriver kun hvis den fortsatt stemmer, ellers får
-- brukeren beskjed om at noen andre har lagret.
--
-- Tenant-modell som resten av appen: RLS er bedriftsgrensen, finere regler
-- (hvem kan redigere) håndheves i server-actions. Alle policies bruker
-- (select auth.uid()) for å unngå per-rad InitPlan-kall (jf. db/69).
--
-- Idempotent: safe to re-run.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- project_models
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.project_models (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id       UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name             TEXT NOT NULL DEFAULT 'Modell',
  -- 'generating' settes mens KI jobber, slik at UI kan vise fremdrift og
  -- hindre at to genereringer skriver over hverandre.
  status           TEXT NOT NULL DEFAULT 'ready'
                     CHECK (status IN ('generating', 'ready', 'failed')),
  source           TEXT NOT NULL DEFAULT 'manual'
                     CHECK (source IN ('manual', 'ai', 'import')),
  data             JSONB NOT NULL DEFAULT '{}'::jsonb,
  schema_version   INTEGER NOT NULL DEFAULT 1,
  revision         INTEGER NOT NULL DEFAULT 1,
  generation_error TEXT,
  thumbnail_path   TEXT,
  is_primary       BOOLEAN NOT NULL DEFAULT false,
  created_by       UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_project_models_project
  ON public.project_models(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_project_models_company
  ON public.project_models(company_id);
CREATE INDEX IF NOT EXISTS idx_project_models_created_by
  ON public.project_models(created_by) WHERE created_by IS NOT NULL;

-- Maks én hovedmodell per prosjekt (den tilbudsgeneratoren henter mengder fra).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_project_models_primary
  ON public.project_models(project_id) WHERE is_primary;

ALTER TABLE public.project_models ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS company_members_select_project_models ON public.project_models;
CREATE POLICY company_members_select_project_models
  ON public.project_models FOR SELECT
  USING (company_id = (SELECT company_id FROM public.users WHERE id = (SELECT auth.uid())));

DROP POLICY IF EXISTS company_members_insert_project_models ON public.project_models;
CREATE POLICY company_members_insert_project_models
  ON public.project_models FOR INSERT
  WITH CHECK (company_id = (SELECT company_id FROM public.users WHERE id = (SELECT auth.uid())));

DROP POLICY IF EXISTS company_members_update_project_models ON public.project_models;
CREATE POLICY company_members_update_project_models
  ON public.project_models FOR UPDATE
  USING (company_id = (SELECT company_id FROM public.users WHERE id = (SELECT auth.uid())))
  WITH CHECK (company_id = (SELECT company_id FROM public.users WHERE id = (SELECT auth.uid())));

DROP POLICY IF EXISTS company_members_delete_project_models ON public.project_models;
CREATE POLICY company_members_delete_project_models
  ON public.project_models FOR DELETE
  USING (company_id = (SELECT company_id FROM public.users WHERE id = (SELECT auth.uid())));

-- ---------------------------------------------------------------------------
-- project_model_versions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.project_model_versions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id   UUID NOT NULL REFERENCES public.project_models(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  revision   INTEGER NOT NULL,
  label      TEXT,
  data       JSONB NOT NULL,
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uniq_project_model_versions UNIQUE (model_id, revision)
);

CREATE INDEX IF NOT EXISTS idx_project_model_versions_model
  ON public.project_model_versions(model_id, revision DESC);
CREATE INDEX IF NOT EXISTS idx_project_model_versions_company
  ON public.project_model_versions(company_id);
CREATE INDEX IF NOT EXISTS idx_project_model_versions_created_by
  ON public.project_model_versions(created_by) WHERE created_by IS NOT NULL;

ALTER TABLE public.project_model_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS company_members_select_project_model_versions ON public.project_model_versions;
CREATE POLICY company_members_select_project_model_versions
  ON public.project_model_versions FOR SELECT
  USING (company_id = (SELECT company_id FROM public.users WHERE id = (SELECT auth.uid())));

DROP POLICY IF EXISTS company_members_insert_project_model_versions ON public.project_model_versions;
CREATE POLICY company_members_insert_project_model_versions
  ON public.project_model_versions FOR INSERT
  WITH CHECK (company_id = (SELECT company_id FROM public.users WHERE id = (SELECT auth.uid())));

DROP POLICY IF EXISTS company_members_delete_project_model_versions ON public.project_model_versions;
CREATE POLICY company_members_delete_project_model_versions
  ON public.project_model_versions FOR DELETE
  USING (company_id = (SELECT company_id FROM public.users WHERE id = (SELECT auth.uid())));

-- ---------------------------------------------------------------------------
-- project_model_references  (bilder KI-en genererer modellen fra)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.project_model_references (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id     UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  model_id       UUID REFERENCES public.project_models(id) ON DELETE SET NULL,
  storage_bucket TEXT NOT NULL DEFAULT 'project_models',
  storage_path   TEXT NOT NULL,
  file_name      TEXT,
  mime_type      TEXT,
  size_bytes     BIGINT,
  created_by     UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_project_model_references_project
  ON public.project_model_references(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_project_model_references_company
  ON public.project_model_references(company_id);
CREATE INDEX IF NOT EXISTS idx_project_model_references_model
  ON public.project_model_references(model_id) WHERE model_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_project_model_references_created_by
  ON public.project_model_references(created_by) WHERE created_by IS NOT NULL;

ALTER TABLE public.project_model_references ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS company_members_select_project_model_references ON public.project_model_references;
CREATE POLICY company_members_select_project_model_references
  ON public.project_model_references FOR SELECT
  USING (company_id = (SELECT company_id FROM public.users WHERE id = (SELECT auth.uid())));

DROP POLICY IF EXISTS company_members_insert_project_model_references ON public.project_model_references;
CREATE POLICY company_members_insert_project_model_references
  ON public.project_model_references FOR INSERT
  WITH CHECK (company_id = (SELECT company_id FROM public.users WHERE id = (SELECT auth.uid())));

DROP POLICY IF EXISTS company_members_delete_project_model_references ON public.project_model_references;
CREATE POLICY company_members_delete_project_model_references
  ON public.project_model_references FOR DELETE
  USING (company_id = (SELECT company_id FROM public.users WHERE id = (SELECT auth.uid())));

-- ---------------------------------------------------------------------------
-- Storage-bucket for referansebilder + modell-thumbnails.
-- Privat bucket, filnavn lagt ut som {company_id}/{project_id}/{fil} slik at
-- policyene kan scope på første mappenivå (samme mønster som db/48).
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('project_models', 'project_models', false, 26214400)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS project_models_storage_select ON storage.objects;
CREATE POLICY project_models_storage_select ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'project_models'
  AND (storage.foldername(name))[1] = public.get_current_company_id()::text
);

DROP POLICY IF EXISTS project_models_storage_insert ON storage.objects;
CREATE POLICY project_models_storage_insert ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'project_models'
  AND (storage.foldername(name))[1] = public.get_current_company_id()::text
);

DROP POLICY IF EXISTS project_models_storage_delete ON storage.objects;
CREATE POLICY project_models_storage_delete ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'project_models'
  AND (storage.foldername(name))[1] = public.get_current_company_id()::text
);

-- ---------------------------------------------------------------------------
-- updated_at-trigger (samme funksjon som resten av skjemaet bruker)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proname = 'handle_updated_at' AND n.nspname = 'public'
  ) THEN
    DROP TRIGGER IF EXISTS set_project_models_updated_at ON public.project_models;
    CREATE TRIGGER set_project_models_updated_at
      BEFORE UPDATE ON public.project_models
      FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
  END IF;
END $$;
