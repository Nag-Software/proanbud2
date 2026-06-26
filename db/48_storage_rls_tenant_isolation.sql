-- ============================================================================
-- 48_storage_rls_tenant_isolation.sql
-- ----------------------------------------------------------------------------
-- Fixes cross-tenant exposure in three storage buckets whose RLS policies only
-- checked `bucket_id` and ignored the company that owns the file.
--
-- All three buckets lay files out as `{company_id}/.../file`, so we scope every
-- policy on the first path segment: (storage.foldername(name))[1].
--
--   * hms_avvik / ks_checklists  (private buckets): SELECT previously let ANY
--     authenticated user read EVERY company's HMS-deviation and KS-checklist
--     photos. INSERT let a user plant files in any company's folder. Both are now
--     scoped to the caller's company.
--   * message_attachments (public bucket, customer-readable by design): INSERT
--     let one tenant write into another tenant's folder. Now scoped. SELECT for
--     authenticated users is also scoped (defense-in-depth); the bucket stays
--     public so unauthenticated customers can still load attachments via their
--     random-UUID URLs from the public offer page.
--
-- Idempotent: safe to re-run.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- hms_avvik  (private)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS hms_avvik_select ON storage.objects;
CREATE POLICY hms_avvik_select ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'hms_avvik'
  AND (storage.foldername(name))[1] = public.get_current_company_id()::text
);

DROP POLICY IF EXISTS hms_avvik_insert ON storage.objects;
CREATE POLICY hms_avvik_insert ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'hms_avvik'
  AND (storage.foldername(name))[1] = public.get_current_company_id()::text
);

-- ---------------------------------------------------------------------------
-- ks_checklists  (private)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS ks_checklists_select ON storage.objects;
CREATE POLICY ks_checklists_select ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'ks_checklists'
  AND (storage.foldername(name))[1] = public.get_current_company_id()::text
);

DROP POLICY IF EXISTS ks_checklists_insert ON storage.objects;
CREATE POLICY ks_checklists_insert ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'ks_checklists'
  AND (storage.foldername(name))[1] = public.get_current_company_id()::text
);

-- ---------------------------------------------------------------------------
-- message_attachments  (public bucket; only authenticated company users upload)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can upload message attachments" ON storage.objects;
CREATE POLICY "Users can upload message attachments" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'message_attachments'
  AND (storage.foldername(name))[1] = public.get_current_company_id()::text
);

DROP POLICY IF EXISTS "Users can view message attachments" ON storage.objects;
CREATE POLICY "Users can view message attachments" ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'message_attachments'
  AND (storage.foldername(name))[1] = public.get_current_company_id()::text
);

-- ---------------------------------------------------------------------------
-- project_members: WITH CHECK so a manager can't inject a cross-tenant user.
-- The previous FOR ALL policy only had USING (which checks the CALLER's rights),
-- never validating that the inserted user_id belongs to the project's company.
-- The application layer now validates this too; this is defense-in-depth.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  DROP POLICY IF EXISTS admins_manage_project_assignments ON public.project_members;
  CREATE POLICY admins_manage_project_assignments ON public.project_members FOR ALL
    USING (
      public.is_company_admin()
      OR EXISTS (
        SELECT 1 FROM public.project_members pm
        WHERE pm.project_id = project_members.project_id
          AND pm.user_id = auth.uid()
          AND pm.access_level = 'manager'
      )
    )
    WITH CHECK (
      (
        public.is_company_admin()
        OR EXISTS (
          SELECT 1 FROM public.project_members pm
          WHERE pm.project_id = project_members.project_id
            AND pm.user_id = auth.uid()
            AND pm.access_level = 'manager'
        )
      )
      AND EXISTS (
        SELECT 1
        FROM public.users u, public.projects p
        WHERE p.id = project_members.project_id
          AND u.id = project_members.user_id
          AND u.company_id = p.company_id
      )
    );
END $$;
