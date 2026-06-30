-- ============================================================================
-- 63_fix_project_members_manage_policy.sql
-- ----------------------------------------------------------------------------
-- Fix: "Legg til deltaker" fails for Prosjektledere (company role = 'manager').
--
-- The app authorises participant management with canManageProjects(role) =
-- admin OR manager (see deltakere-actions.ts -> assertCanManageParticipants and
-- DeltakereTab's "Legg til deltaker" button, shown when isManager === true).
-- But the RLS policy admins_manage_project_assignments (db/00 -> db/48 -> db/52)
-- only allowed:
--     is_company_admin()                 -- role = 'admin' ONLY (MAX(role)='admin')
--     OR is_project_manager(project_id)  -- a member with access_level='manager'
-- So a company manager who is an ordinary member of a project (access_level
-- 'write'/'read') passes the app check, sees the button, but the INSERT is
-- rejected by RLS -> "Kunne ikke legge til deltaker". Company admins were never
-- affected, which is why it "works for admins but not project leaders".
--
-- Fix: authorise via a SECURITY DEFINER helper that grants management to
--   (a) a project-level manager (member with access_level='manager'), OR
--   (b) a company admin OR manager, scoped to the project's OWN company.
-- SECURITY DEFINER is required so the check does not depend on the caller's
-- projects/project_members SELECT policies (view_assigned_projects only lets a
-- non-admin manager see projects they are a member of) and so the inner
-- project_members read does not re-trigger this very policy (no recursion).
--
-- This also tightens tenant isolation vs the previous policy: the old
-- is_company_admin() branch was global (an admin's USING was satisfied for ANY
-- company's rows). The new branch is scoped to the project's company on both
-- USING and WITH CHECK. The cross-tenant assigned-user guard is preserved.
--
-- Idempotent: safe to re-run.
-- ============================================================================

-- Can the current user manage members of this project?
--   project-level manager  OR  company admin/manager of the project's company.
CREATE OR REPLACE FUNCTION public.can_manage_project_members(p_project_id UUID)
RETURNS BOOLEAN AS $$
  SELECT
    -- (a) project-level manager: a member with manager access on this project
    EXISTS (
      SELECT 1
      FROM public.project_members pm
      WHERE pm.project_id = p_project_id
        AND pm.user_id = auth.uid()
        AND pm.access_level = 'manager'
    )
    OR
    -- (b) company admin/manager, restricted to the project's own company
    EXISTS (
      SELECT 1
      FROM public.users u
      JOIN public.projects p ON p.company_id = u.company_id
      WHERE u.id = auth.uid()
        AND u.role IN ('admin', 'manager')
        AND p.id = p_project_id
    );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- The assigned user must belong to the project's company (defence-in-depth so a
-- manager cannot inject a cross-tenant user UUID into project_members).
CREATE OR REPLACE FUNCTION public.assigned_user_in_project_company(
  p_project_id UUID,
  p_user_id UUID
)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    JOIN public.projects p ON p.company_id = u.company_id
    WHERE u.id = p_user_id
      AND p.id = p_project_id
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

DROP POLICY IF EXISTS admins_manage_project_assignments ON public.project_members;
CREATE POLICY admins_manage_project_assignments ON public.project_members FOR ALL
  USING (
    public.can_manage_project_members(project_members.project_id)
  )
  WITH CHECK (
    public.can_manage_project_members(project_members.project_id)
    AND public.assigned_user_in_project_company(
          project_members.project_id,
          project_members.user_id
        )
  );
