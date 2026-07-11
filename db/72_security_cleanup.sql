-- 72: Sikkerhetsopprydding fra Supabase security advisor.
--
-- a) companies.allow_authenticated_insert var WITH CHECK (true) — enhver
--    innlogget bruker kunne opprette vilkårlige bedriftsrader direkte via
--    PostgREST og dermed omgå validering, trial-vakt og én-bedrift-guarden.
--    All reell opprettelse skjer server-side med service role
--    (app/api/companies/route.ts), så policyen er ubrukt av appen. Fjernes.
DROP POLICY IF EXISTS "allow_authenticated_insert" ON public.companies;

-- b) schema_migrations lå åpen uten RLS (Supabase-lint ERROR). Runneren
--    (scripts/run-migrations.mjs) kobler som tabelleier og service role har
--    BYPASSRLS — begge upåvirket. Klientroller mister innsyn.
ALTER TABLE public.schema_migrations ENABLE ROW LEVEL SECURITY;

-- c) company-logos-bucketen er public: filer serveres via public URL uten
--    SELECT-policy. Den brede SELECT-policyen ga i praksis LISTING av alle
--    filer for hvem som helst — fjernes. Skriv-policyene var uscopet (alle
--    innloggede kunne overskrive ANDRE firmaers logo) — scopes til eget
--    firma (opplastingssti er `<company_id>/logo.<ext>`,
--    jf. app/min-bedrift/bedriftsprofil/bedriftsprofil-client.tsx).
DROP POLICY IF EXISTS "Anyone can view company logos" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload company logos" ON storage.objects;
DROP POLICY IF EXISTS "Users can update company logos" ON storage.objects;

CREATE POLICY "company_logos_insert_own_company" ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'company-logos'
    AND (storage.foldername(name))[1] = ((select public.get_current_company_id()))::text
  );

CREATE POLICY "company_logos_update_own_company" ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'company-logos'
    AND (storage.foldername(name))[1] = ((select public.get_current_company_id()))::text
  )
  WITH CHECK (
    bucket_id = 'company-logos'
    AND (storage.foldername(name))[1] = ((select public.get_current_company_id()))::text
  );
