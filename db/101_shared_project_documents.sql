-- Prosjektdokumenter deles på prosjektet.
--
-- Før: alle dokumenter var private for den som lastet dem opp (document_items og
-- storage-mappen {user_id}/…). Lederens tegninger var usynlige for håndverkerne,
-- og håndverkernes bilder for lederen – også når de lå i prosjektets mappe.
--
-- Nå: filer i prosjektmappen «prosjekter/{prosjekt-id}/…» får project_id, og alle
-- med tilgang til prosjektet kan SE dem (tabell + lagring). Å gi nytt navn, flytte
-- og slette er fortsatt bare for den som lastet opp (owner_manage_document_items).
--
-- project_id settes av en trigger, og bare når den som laster opp faktisk har
-- tilgang til prosjektet – ellers kunne man lagt filer inn i et annet firmas prosjekt.

ALTER TABLE public.document_items
  ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_document_items_project_parent
  ON public.document_items (project_id, external_parent_id)
  WHERE project_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_document_items_project_storage_path
  ON public.document_items (storage_path)
  WHERE project_id IS NOT NULL;

-- Prosjekt-id fra en mappesti, men bare når brukeren hører til prosjektets firma og
-- er admin/leder der, eller deltaker på prosjektet. Tar bruker-id som parameter, så
-- den også virker når en bakgrunnsjobb skriver med service role (auth.uid() er NULL).
CREATE OR REPLACE FUNCTION public.document_project_id_for(p_user_id UUID, p_parent_path TEXT)
RETURNS UUID AS $$
DECLARE
  candidate UUID;
BEGIN
  IF p_user_id IS NULL OR p_parent_path IS NULL THEN
    RETURN NULL;
  END IF;

  candidate := (
    substring(
      p_parent_path
      FROM '^prosjekter/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})(/|$)'
    )
  )::uuid;
  IF candidate IS NULL THEN
    RETURN NULL;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.projects p
    JOIN public.users u ON u.id = p_user_id AND u.company_id = p.company_id
    WHERE p.id = candidate
      AND (
        u.role IN ('admin', 'manager')
        OR EXISTS (
          SELECT 1 FROM public.project_members pm
          WHERE pm.project_id = candidate AND pm.user_id = p_user_id
        )
      )
  ) THEN
    RETURN candidate;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.document_project_id_for(UUID, TEXT) FROM PUBLIC;

-- Eksisterende filer i prosjektmapper (før triggeren finnes).
UPDATE public.document_items d
SET project_id = public.document_project_id_for(d.user_id, d.external_parent_id)
WHERE d.project_id IS NULL
  AND d.external_parent_id LIKE 'prosjekter/%';

CREATE OR REPLACE FUNCTION public.set_document_item_project_id()
RETURNS TRIGGER AS $$
BEGIN
  -- Bare når plasseringen endres: andre oppdateringer (f.eks. synk fra en
  -- bakgrunnsjobb) skal ikke røre prosjekttilhørigheten.
  IF TG_OP = 'INSERT' OR NEW.external_parent_id IS DISTINCT FROM OLD.external_parent_id THEN
    NEW.project_id := public.document_project_id_for(NEW.user_id, NEW.external_parent_id);
  END IF;
  RETURN NEW;
END;
-- SECURITY DEFINER: triggeren kaller hjelperen som eier, så hjelperen kan holdes
-- lukket for direkte kall fra klienter (den ville ellers avslørt prosjektmedlemskap).
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS document_items_set_project_id ON public.document_items;
CREATE TRIGGER document_items_set_project_id
  BEFORE INSERT OR UPDATE ON public.document_items
  FOR EACH ROW EXECUTE FUNCTION public.set_document_item_project_id();

-- Lesetilgang for alle med tilgang til prosjektet. Kommer i tillegg til
-- eierpolicyen (owner_manage_document_items), som fortsatt styrer skriving.
DROP POLICY IF EXISTS "project_members_read_project_documents" ON public.document_items;
CREATE POLICY "project_members_read_project_documents" ON public.document_items
  FOR SELECT
  TO authenticated
  USING (
    project_id IS NOT NULL
    AND (
      public.has_project_access(project_id)
      OR (
        (SELECT public.is_company_manager_or_admin())
        AND EXISTS (
          SELECT 1 FROM public.projects p
          WHERE p.id = document_items.project_id
            AND p.company_id = (SELECT public.get_current_company_id())
        )
      )
    )
  );

-- Samme for selve filene i lagringen, slik at signerte lenker kan lages for
-- andres filer i prosjektet. Raden i document_items avgjør (policyen over).
DROP POLICY IF EXISTS "documents_bucket_project_read" ON storage.objects;
CREATE POLICY "documents_bucket_project_read" ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'documents'
    AND EXISTS (
      SELECT 1
      FROM public.document_items d
      WHERE d.storage_bucket = 'documents'
        AND d.storage_path = storage.objects.name
        AND d.project_id IS NOT NULL
    )
  );

COMMENT ON COLUMN public.document_items.project_id IS
  'Prosjektet filen tilhører (fra mappen prosjekter/{id}/…). Settes av trigger; gir lesetilgang for alle med tilgang til prosjektet.';
