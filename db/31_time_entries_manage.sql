-- ==========================================
-- TIMEFØRING: rediger/slett fullførte registreringer
-- ==========================================
-- Workers kan allerede endre/slette egne økter via
-- policyen users_manage_own_time_entries (FOR ALL).
-- Her åpner vi for at managers/admins kan endre/slette
-- ALLE registreringer i egen bedrift (lønn/fakturering-korreksjon).

-- UPDATE for managers/admins på hele bedriften
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'time_entries'
      AND policyname = 'managers_update_company_time_entries'
  ) THEN
    CREATE POLICY managers_update_company_time_entries ON public.time_entries FOR UPDATE
      USING (
        company_id = public.get_current_company_id()
        AND public.is_company_manager_or_admin()
      )
      WITH CHECK (
        company_id = public.get_current_company_id()
        AND public.is_company_manager_or_admin()
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'time_entries'
      AND policyname = 'managers_delete_company_time_entries'
  ) THEN
    CREATE POLICY managers_delete_company_time_entries ON public.time_entries FOR DELETE
      USING (
        company_id = public.get_current_company_id()
        AND public.is_company_manager_or_admin()
      );
  END IF;
END$$;
