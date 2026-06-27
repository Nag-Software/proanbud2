-- ============================================================================
-- 52_fix_project_members_rls_recursion.sql
-- ----------------------------------------------------------------------------
-- Fix: "infinite recursion detected in policy for relation project_members".
--
-- The `admins_manage_project_assignments` policy on public.project_members
-- (FOR ALL, so it also applies to SELECT) inlined
--   EXISTS (SELECT 1 FROM public.project_members pm WHERE ...)
-- inside its own USING/WITH CHECK. Evaluating the policy therefore re-queries
-- project_members, which re-evaluates the policy → infinite recursion. Any query
-- that reaches project_members under RLS fails — including deviations_select
-- (db/26), which is why /hms and /avvik throw (getDeviationsAction).
--
-- This predates the kjørebok work (introduced in db/00 and re-applied in db/48);
-- it is unrelated to db/51.
--
-- Fix: do the "is manager on this project" lookup inside a SECURITY DEFINER
-- function (RLS bypassed inside the function body, exactly like the existing
-- has_project_access()), so the policy no longer self-references. Authorization
-- semantics are unchanged: company admin OR project manager may manage
-- assignments; the cross-tenant WITH CHECK is preserved.
--
-- Idempotent: safe to re-run.
-- ============================================================================

-- Manager-on-project check, RLS-safe (SECURITY DEFINER bypasses the caller's RLS
-- so the inner project_members read does NOT re-trigger project_members policies).
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

DROP POLICY IF EXISTS admins_manage_project_assignments ON public.project_members;
CREATE POLICY admins_manage_project_assignments ON public.project_members FOR ALL
  USING (
    public.is_company_admin()
    OR public.is_project_manager(project_members.project_id)
  )
  WITH CHECK (
    (
      public.is_company_admin()
      OR public.is_project_manager(project_members.project_id)
    )
    -- Defense-in-depth: the assigned user must belong to the project's company.
    AND EXISTS (
      SELECT 1
      FROM public.users u, public.projects p
      WHERE p.id = project_members.project_id
        AND u.id = project_members.user_id
        AND u.company_id = p.company_id
    )
  );
