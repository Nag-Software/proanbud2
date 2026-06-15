-- ==========================================
-- KS / Sjekklister
-- ==========================================

-- Utvid avvik med kobling til sjekklistepunkter
ALTER TABLE public.deviations
  ADD COLUMN IF NOT EXISTS checklist_item_id UUID,
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'deviations_source_check'
  ) THEN
    ALTER TABLE public.deviations
      ADD CONSTRAINT deviations_source_check
      CHECK (source IN ('manual', 'checklist'));
  END IF;
END $$;

-- ==========================================
-- MALBIBLIOTEK
-- ==========================================

CREATE TABLE IF NOT EXISTS public.checklist_template_categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.checklist_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  category_id UUID REFERENCES public.checklist_template_categories(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  description TEXT,
  language TEXT NOT NULL DEFAULT 'no' CHECK (language IN ('no', 'en', 'pl')),
  is_system BOOLEAN NOT NULL DEFAULT false,
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.checklist_template_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  template_id UUID NOT NULL REFERENCES public.checklist_templates(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL,
  description TEXT,
  requires_photo BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ==========================================
-- PROSJEKT-SJEKklister
-- ==========================================

CREATE TABLE IF NOT EXISTS public.project_checklists (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  template_id UUID REFERENCES public.checklist_templates(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'not_started'
    CHECK (status IN ('not_started', 'in_progress', 'completed')),
  created_by UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.project_checklist_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  checklist_id UUID NOT NULL REFERENCES public.project_checklists(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL,
  description TEXT,
  requires_photo BOOLEAN NOT NULL DEFAULT false,
  response TEXT CHECK (response IS NULL OR response IN ('ok', 'not_ok', 'na')),
  comment TEXT,
  responded_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  responded_at TIMESTAMPTZ,
  deviation_id UUID REFERENCES public.deviations(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- FK fra avvik til sjekklistepunkt (etter at tabellen finnes)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'deviations_checklist_item_id_fkey'
  ) THEN
    ALTER TABLE public.deviations
      ADD CONSTRAINT deviations_checklist_item_id_fkey
      FOREIGN KEY (checklist_item_id)
      REFERENCES public.project_checklist_items(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.checklist_item_attachments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  item_id UUID NOT NULL REFERENCES public.project_checklist_items(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  uploaded_by UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  file_name TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  mime_type TEXT,
  size_bytes INTEGER,
  annotation_json JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ==========================================
-- INDEXES
-- ==========================================

CREATE INDEX IF NOT EXISTS idx_checklist_templates_company ON public.checklist_templates (company_id);
CREATE INDEX IF NOT EXISTS idx_checklist_templates_category ON public.checklist_templates (category_id);
CREATE INDEX IF NOT EXISTS idx_project_checklists_project_status ON public.project_checklists (project_id, status);
CREATE INDEX IF NOT EXISTS idx_project_checklists_company ON public.project_checklists (company_id);
CREATE INDEX IF NOT EXISTS idx_project_checklist_items_checklist ON public.project_checklist_items (checklist_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_checklist_item_attachments_item ON public.checklist_item_attachments (item_id);

-- ==========================================
-- TRIGGERS
-- ==========================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_checklist_templates') THEN
    CREATE TRIGGER set_updated_at_checklist_templates
      BEFORE UPDATE ON public.checklist_templates
      FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_project_checklists') THEN
    CREATE TRIGGER set_updated_at_project_checklists
      BEFORE UPDATE ON public.project_checklists
      FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_project_checklist_items') THEN
    CREATE TRIGGER set_updated_at_project_checklist_items
      BEFORE UPDATE ON public.project_checklist_items
      FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
  END IF;
END$$;

-- ==========================================
-- RLS
-- ==========================================

ALTER TABLE public.checklist_template_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checklist_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checklist_template_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_checklists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_checklist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checklist_item_attachments ENABLE ROW LEVEL SECURITY;

-- Kategorier: alle innloggede kan lese
DROP POLICY IF EXISTS checklist_categories_select ON public.checklist_template_categories;
CREATE POLICY checklist_categories_select ON public.checklist_template_categories
  FOR SELECT TO authenticated USING (true);

-- Maler: systemmaler + egne bedriftsmaler
DROP POLICY IF EXISTS checklist_templates_select ON public.checklist_templates;
CREATE POLICY checklist_templates_select ON public.checklist_templates FOR SELECT TO authenticated
USING (
  is_system = true
  OR company_id = public.get_current_company_id()
);

DROP POLICY IF EXISTS checklist_templates_insert ON public.checklist_templates;
CREATE POLICY checklist_templates_insert ON public.checklist_templates FOR INSERT TO authenticated
WITH CHECK (
  company_id = public.get_current_company_id()
  AND is_system = false
  AND public.is_company_manager_or_admin()
);

DROP POLICY IF EXISTS checklist_templates_update ON public.checklist_templates;
CREATE POLICY checklist_templates_update ON public.checklist_templates FOR UPDATE TO authenticated
USING (
  company_id = public.get_current_company_id()
  AND is_system = false
  AND public.is_company_manager_or_admin()
)
WITH CHECK (
  company_id = public.get_current_company_id()
  AND is_system = false
);

DROP POLICY IF EXISTS checklist_templates_delete ON public.checklist_templates;
CREATE POLICY checklist_templates_delete ON public.checklist_templates FOR DELETE TO authenticated
USING (
  company_id = public.get_current_company_id()
  AND is_system = false
  AND public.is_company_manager_or_admin()
);

-- Malpunkter
DROP POLICY IF EXISTS checklist_template_items_select ON public.checklist_template_items;
CREATE POLICY checklist_template_items_select ON public.checklist_template_items FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.checklist_templates t
    WHERE t.id = template_id
      AND (t.is_system = true OR t.company_id = public.get_current_company_id())
  )
);

DROP POLICY IF EXISTS checklist_template_items_insert ON public.checklist_template_items;
CREATE POLICY checklist_template_items_insert ON public.checklist_template_items FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.checklist_templates t
    WHERE t.id = template_id
      AND t.company_id = public.get_current_company_id()
      AND t.is_system = false
      AND public.is_company_manager_or_admin()
  )
);

DROP POLICY IF EXISTS checklist_template_items_update ON public.checklist_template_items;
CREATE POLICY checklist_template_items_update ON public.checklist_template_items FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.checklist_templates t
    WHERE t.id = template_id
      AND t.company_id = public.get_current_company_id()
      AND t.is_system = false
      AND public.is_company_manager_or_admin()
  )
);

DROP POLICY IF EXISTS checklist_template_items_delete ON public.checklist_template_items;
CREATE POLICY checklist_template_items_delete ON public.checklist_template_items FOR DELETE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.checklist_templates t
    WHERE t.id = template_id
      AND t.company_id = public.get_current_company_id()
      AND t.is_system = false
      AND public.is_company_manager_or_admin()
  )
);

-- Prosjekt-sjekklister
DROP POLICY IF EXISTS project_checklists_select ON public.project_checklists;
CREATE POLICY project_checklists_select ON public.project_checklists FOR SELECT TO authenticated
USING (
  company_id = public.get_current_company_id()
  AND (
    public.is_company_manager_or_admin()
    OR public.has_project_access(project_id)
  )
);

DROP POLICY IF EXISTS project_checklists_insert ON public.project_checklists;
CREATE POLICY project_checklists_insert ON public.project_checklists FOR INSERT TO authenticated
WITH CHECK (
  company_id = public.get_current_company_id()
  AND public.has_project_access(project_id)
  AND created_by = auth.uid()
);

DROP POLICY IF EXISTS project_checklists_update ON public.project_checklists;
CREATE POLICY project_checklists_update ON public.project_checklists FOR UPDATE TO authenticated
USING (
  company_id = public.get_current_company_id()
  AND public.has_project_access(project_id)
)
WITH CHECK (company_id = public.get_current_company_id());

-- Sjekklistepunkter
DROP POLICY IF EXISTS project_checklist_items_select ON public.project_checklist_items;
CREATE POLICY project_checklist_items_select ON public.project_checklist_items FOR SELECT TO authenticated
USING (
  company_id = public.get_current_company_id()
  AND EXISTS (
    SELECT 1 FROM public.project_checklists pc
    WHERE pc.id = checklist_id
      AND (
        public.is_company_manager_or_admin()
        OR public.has_project_access(pc.project_id)
      )
  )
);

DROP POLICY IF EXISTS project_checklist_items_insert ON public.project_checklist_items;
CREATE POLICY project_checklist_items_insert ON public.project_checklist_items FOR INSERT TO authenticated
WITH CHECK (
  company_id = public.get_current_company_id()
  AND EXISTS (
    SELECT 1 FROM public.project_checklists pc
    WHERE pc.id = checklist_id
      AND public.has_project_access(pc.project_id)
  )
);

DROP POLICY IF EXISTS project_checklist_items_update ON public.project_checklist_items;
CREATE POLICY project_checklist_items_update ON public.project_checklist_items FOR UPDATE TO authenticated
USING (
  company_id = public.get_current_company_id()
  AND EXISTS (
    SELECT 1 FROM public.project_checklists pc
    WHERE pc.id = checklist_id
      AND public.has_project_access(pc.project_id)
  )
)
WITH CHECK (company_id = public.get_current_company_id());

-- Vedlegg
DROP POLICY IF EXISTS checklist_item_attachments_select ON public.checklist_item_attachments;
CREATE POLICY checklist_item_attachments_select ON public.checklist_item_attachments FOR SELECT TO authenticated
USING (company_id = public.get_current_company_id());

DROP POLICY IF EXISTS checklist_item_attachments_insert ON public.checklist_item_attachments;
CREATE POLICY checklist_item_attachments_insert ON public.checklist_item_attachments FOR INSERT TO authenticated
WITH CHECK (
  company_id = public.get_current_company_id()
  AND uploaded_by = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.project_checklist_items pci
    JOIN public.project_checklists pc ON pc.id = pci.checklist_id
    WHERE pci.id = item_id
      AND public.has_project_access(pc.project_id)
  )
);

DROP POLICY IF EXISTS checklist_item_attachments_delete ON public.checklist_item_attachments;
CREATE POLICY checklist_item_attachments_delete ON public.checklist_item_attachments FOR DELETE TO authenticated
USING (
  company_id = public.get_current_company_id()
  AND uploaded_by = auth.uid()
);

-- ==========================================
-- STORAGE
-- ==========================================

DO $$
BEGIN
  INSERT INTO storage.buckets (id, name, public)
  VALUES ('ks_checklists', 'ks_checklists', false)
  ON CONFLICT (id) DO NOTHING;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Create ks_checklists bucket manually if needed.';
END $$;

DROP POLICY IF EXISTS ks_checklists_select ON storage.objects;
CREATE POLICY ks_checklists_select ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'ks_checklists');

DROP POLICY IF EXISTS ks_checklists_insert ON storage.objects;
CREATE POLICY ks_checklists_insert ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'ks_checklists');

DROP POLICY IF EXISTS ks_checklists_delete ON storage.objects;
CREATE POLICY ks_checklists_delete ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'ks_checklists' AND owner = auth.uid());

-- ==========================================
-- SEED: Kategorier og systemmaler
-- ==========================================

INSERT INTO public.checklist_template_categories (slug, name, sort_order) VALUES
  ('vatrom', 'Våtrom', 1),
  ('tek17', 'TEK17', 2),
  ('rehab', 'Rehab', 3),
  ('generelt', 'Generelt', 4),
  ('overlevering', 'Overlevering', 5)
ON CONFLICT (slug) DO NOTHING;

-- Seed templates only if none exist
DO $$
DECLARE
  cat_vatrom UUID;
  cat_tek17 UUID;
  cat_rehab UUID;
  cat_generelt UUID;
  cat_overlevering UUID;
  tpl_id UUID;
BEGIN
  IF EXISTS (SELECT 1 FROM public.checklist_templates WHERE is_system = true LIMIT 1) THEN
    RETURN;
  END IF;

  SELECT id INTO cat_vatrom FROM public.checklist_template_categories WHERE slug = 'vatrom';
  SELECT id INTO cat_tek17 FROM public.checklist_template_categories WHERE slug = 'tek17';
  SELECT id INTO cat_rehab FROM public.checklist_template_categories WHERE slug = 'rehab';
  SELECT id INTO cat_generelt FROM public.checklist_template_categories WHERE slug = 'generelt';
  SELECT id INTO cat_overlevering FROM public.checklist_template_categories WHERE slug = 'overlevering';

  -- Våtrom: Membran og tetting
  INSERT INTO public.checklist_templates (company_id, category_id, name, description, language, is_system)
  VALUES (NULL, cat_vatrom, 'Våtrom — membran og tetting', 'Kontroll av membran, skjøter og gjennomføringer', 'no', true)
  RETURNING id INTO tpl_id;
  INSERT INTO public.checklist_template_items (template_id, sort_order, title, description, requires_photo) VALUES
    (tpl_id, 1, 'Membran montert iht. produsentens anvisning', 'Sjekk at membran er riktig limt og uten skader', true),
    (tpl_id, 2, 'Skjøter overlappes minimum 100 mm', 'Kontroller alle skjøter med linjal', true),
    (tpl_id, 3, 'Gjennomføringer tettet', 'Rør, sluk og ventiler — bruk riktig mansjett', true),
    (tpl_id, 4, 'Hjørner og bunnsviller forsterket', 'Ekstra lag membran i kritiske punkter', false),
    (tpl_id, 5, 'Membran hevet minimum 25 mm over gulv', 'Ved dørterskel og overgang til tørt rom', true),
    (tpl_id, 6, 'Prøvetetting utført og dokumentert', 'Fyll bunn sluk og ventil, kontroller etter 24 timer', true),
    (tpl_id, 7, 'Fall mot sluk minimum 1:100', 'Mål fall med vater eller laser', true),
    (tpl_id, 8, 'Sluk montert i riktig høyde', 'Sluttstykke flush med ferdig gulv', true);

  -- Våtrom: Flis og overflate
  INSERT INTO public.checklist_templates (company_id, category_id, name, description, language, is_system)
  VALUES (NULL, cat_vatrom, 'Våtrom — flis og overflate', 'Kontroll av flislegging og fuger', 'no', true)
  RETURNING id INTO tpl_id;
  INSERT INTO public.checklist_template_items (template_id, sort_order, title, description, requires_photo) VALUES
    (tpl_id, 1, 'Fliser limt med riktig lim for våtrom', 'Sjekk produktdatablad og påføringsmetode', false),
    (tpl_id, 2, 'Fuger tette og jevne', 'Ingen hulrom eller sprekker', true),
    (tpl_id, 3, 'Hjørnelister/silikonfuger utført', 'Silikon mot våtsone og overganger', true),
    (tpl_id, 4, 'Skjærekanter avsluttet pent', 'Ingen skarpe kanter eller løse fliser', true),
    (tpl_id, 5, 'Rengjort og klart for overlevering', 'Ingen limrester eller støv', false);

  -- TEK17: Fukt og lufting
  INSERT INTO public.checklist_templates (company_id, category_id, name, description, language, is_system)
  VALUES (NULL, cat_tek17, 'TEK17 — fukt og lufting', 'Krav til fuktbeskyttelse og ventilasjon', 'no', true)
  RETURNING id INTO tpl_id;
  INSERT INTO public.checklist_template_items (template_id, sort_order, title, description, requires_photo) VALUES
    (tpl_id, 1, 'Dampsperre montert med tette skjøter', 'Minimum 100 mm overlapp, teipet', true),
    (tpl_id, 2, 'Vindsperre montert korrekt', 'Uten hull og med overlappende skjøter', true),
    (tpl_id, 3, 'Ventilasjon dimensjonert og montert', 'Sjekk at avtrekk og tilluft er på plass', false),
    (tpl_id, 4, 'Radonmembran montert (hvis aktuelt)', 'Iht. TEK17 og kommuneplan', true),
    (tpl_id, 5, 'Fuktmåling utført og innenfor krav', 'Dokumenter måleresultat', true),
    (tpl_id, 6, 'Lufttetthet testet (iflg. krav)', 'Blower door eller tilsvarende', false);

  -- TEK17: Dokumentasjon
  INSERT INTO public.checklist_templates (company_id, category_id, name, description, language, is_system)
  VALUES (NULL, cat_tek17, 'TEK17 — dokumentasjon', 'Kontroll av nødvendig dokumentasjon', 'no', true)
  RETURNING id INTO tpl_id;
  INSERT INTO public.checklist_template_items (template_id, sort_order, title, description, requires_photo) VALUES
    (tpl_id, 1, 'Produktdatablad arkivert', 'Alle materialer med TEK17-relevans', false),
    (tpl_id, 2, 'Samsvarserklæringer foreligger', 'For bærende konstruksjoner og VVS', false),
    (tpl_id, 3, 'FDV-dokumentasjon påbegynt', 'Drift og vedlikeholdsplan', false),
    (tpl_id, 4, 'Energiattest bestilt/utført', 'For ferdigattest', false),
    (tpl_id, 5, 'Fotodokumentasjon skjulte installasjoner', 'Før stenging av konstruksjon', true);

  -- Rehab: Befaring og riving
  INSERT INTO public.checklist_templates (company_id, category_id, name, description, language, is_system)
  VALUES (NULL, cat_rehab, 'Rehab — befaring og riving', 'Kontroll før og under rivingsarbeid', 'no', true)
  RETURNING id INTO tpl_id;
  INSERT INTO public.checklist_template_items (template_id, sort_order, title, description, requires_photo) VALUES
    (tpl_id, 1, 'Befaring dokumentert med bilder', 'Eksisterende tilstand før start', true),
    (tpl_id, 2, 'Asbest/farlig avfall kartlagt', 'Prøvetaking og rapport', true),
    (tpl_id, 3, 'Naboer varslet om støy/støv', 'Skriftlig varsel der det kreves', false),
    (tpl_id, 4, 'Riving utført kontrollert', 'Ingen skade på bærende konstruksjon', true),
    (tpl_id, 5, 'Avfall sortert og deponert korrekt', 'Avfallsbeholdere merket', true),
    (tpl_id, 6, 'Rengjort og klargjort for nytt arbeid', 'Arbeidsområde ryddig', false);

  -- Generelt: Materialer
  INSERT INTO public.checklist_templates (company_id, category_id, name, description, language, is_system)
  VALUES (NULL, cat_generelt, 'Generell KS — materialer', 'Kontroll av mottatte og brukte materialer', 'no', true)
  RETURNING id INTO tpl_id;
  INSERT INTO public.checklist_template_items (template_id, sort_order, title, description, requires_photo) VALUES
    (tpl_id, 1, 'Materialer samsvarer med spesifikasjon', 'Sjekk mot bestilling og tegninger', false),
    (tpl_id, 2, 'Materialer lagret forsvarlig', 'Beskyttet mot fukt og skade', true),
    (tpl_id, 3, 'CE-merkede produkter brukt der påkrevd', 'Sjekk merking', false),
    (tpl_id, 4, 'Batch/lot-nummer notert', 'For sporbarhet', false),
    (tpl_id, 5, 'Defekte materialer avvist og registrert', 'Avvik opprettet ved behov', false);

  -- Generelt: Arbeidsutførelse
  INSERT INTO public.checklist_templates (company_id, category_id, name, description, language, is_system)
  VALUES (NULL, cat_generelt, 'Generell KS — arbeidsutførelse', 'Daglig kvalitetskontroll på byggeplass', 'no', true)
  RETURNING id INTO tpl_id;
  INSERT INTO public.checklist_template_items (template_id, sort_order, title, description, requires_photo) VALUES
    (tpl_id, 1, 'Arbeid utført iht. tegninger og beskrivelse', 'Avvik fra tegning godkjent skriftlig', false),
    (tpl_id, 2, 'Verktøy og utstyr i god stand', 'Kalibrert der det kreves', false),
    (tpl_id, 3, 'HMS-tiltak fulgt', 'Verneutstyr, sperringer, ryddighet', true),
    (tpl_id, 4, 'Underentreprenørers arbeid kontrollert', 'Stikkprøve og dokumentasjon', false),
    (tpl_id, 5, 'Arbeidsområde ryddet ved dagsslutt', 'Opprydding og avfall fjernet', true);

  -- Overlevering
  INSERT INTO public.checklist_templates (company_id, category_id, name, description, language, is_system)
  VALUES (NULL, cat_overlevering, 'Overlevering — sluttkontroll', 'Kontroll før overlevering til byggherre', 'no', true)
  RETURNING id INTO tpl_id;
  INSERT INTO public.checklist_template_items (template_id, sort_order, title, description, requires_photo) VALUES
    (tpl_id, 1, 'Alle avvik lukket eller dokumentert', 'Ingen åpne KS-punkter', false),
    (tpl_id, 2, 'Rengjøring utført', 'Bygget klart for befaring', true),
    (tpl_id, 3, 'Nøkler og dokumenter samlet', 'FDV, garantier, bruksanvisninger', false),
    (tpl_id, 4, 'Gjenstandsliste gjennomgått med kunde', 'Alt avtalt levert', false),
    (tpl_id, 5, 'Befaring gjennomført og protokoll signert', 'Eventuelle merknader notert', true),
    (tpl_id, 6, 'Garantitid og reklamasjonsfrist informert', 'Skriftlig bekreftelse', false);
END $$;
