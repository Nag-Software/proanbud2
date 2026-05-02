-- Onboarding-safe users model:
-- 1) allow users row before company is created
-- 2) ensure users can always read their own row

ALTER TABLE IF EXISTS public.users
  ALTER COLUMN company_id DROP NOT NULL;

-- Replace policy so users can read their own row even with NULL company_id.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'users'
      AND policyname = 'view_users_in_same_company'
  ) THEN
    DROP POLICY view_users_in_same_company ON public.users;
  END IF;

  CREATE POLICY view_users_in_same_company ON public.users FOR SELECT
    USING (
      id = auth.uid()
      OR (
        company_id IS NOT NULL
        AND company_id = public.get_current_company_id()
      )
    );
END
$$;
