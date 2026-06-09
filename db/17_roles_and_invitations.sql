-- ==========================================
-- ROLES, INVITATIONS & TIME ENTRIES
-- ==========================================

CREATE TABLE IF NOT EXISTS public.roles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (company_id, name)
);

CREATE TABLE IF NOT EXISTS public.user_roles (
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE IF NOT EXISTS public.invitations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  invited_by UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.invitation_roles (
  invitation_id UUID NOT NULL REFERENCES public.invitations(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  PRIMARY KEY (invitation_id, role_id)
);

CREATE TABLE IF NOT EXISTS public.time_entries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
  hours NUMERIC(4, 2) NOT NULL CHECK (hours > 0 AND hours <= 24),
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_roles_company_id ON public.roles(company_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON public.user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_invitations_company_status ON public.invitations(company_id, status);
CREATE INDEX IF NOT EXISTS idx_invitations_token_hash ON public.invitations(token_hash);
CREATE INDEX IF NOT EXISTS idx_time_entries_project_user ON public.time_entries(project_id, user_id);

-- Seed default roles for existing companies
INSERT INTO public.roles (company_id, name)
SELECT c.id, role_name
FROM public.companies c
CROSS JOIN (
  VALUES ('Administrator'), ('Prosjektleder'), ('Håndverker')
) AS defaults(role_name)
ON CONFLICT (company_id, name) DO NOTHING;

-- Backfill user_roles from users.role where missing
INSERT INTO public.user_roles (user_id, role_id)
SELECT u.id, r.id
FROM public.users u
JOIN public.roles r
  ON r.company_id = u.company_id
 AND r.name = CASE u.role
    WHEN 'admin' THEN 'Administrator'
    WHEN 'manager' THEN 'Prosjektleder'
    ELSE 'Håndverker'
  END
LEFT JOIN public.user_roles ur ON ur.user_id = u.id
WHERE ur.user_id IS NULL
ON CONFLICT DO NOTHING;

-- Helper: manager or admin in company
CREATE OR REPLACE FUNCTION public.is_company_manager_or_admin()
RETURNS BOOLEAN AS $$
  SELECT COALESCE(
    (
      SELECT u.role IN ('admin', 'manager')
      FROM public.users u
      WHERE u.id = auth.uid()
    ),
    false
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Helper: workers with project access can update task status
CREATE OR REPLACE FUNCTION public.can_update_task_status(p_project_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  IF NOT public.has_project_access(p_project_id) THEN
    RETURN false;
  END IF;

  IF public.is_company_admin() OR public.is_company_manager_or_admin() THEN
    RETURN true;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.project_members pm
    WHERE pm.project_id = p_project_id
      AND pm.user_id = auth.uid()
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_time_entries') THEN
    CREATE TRIGGER set_updated_at_time_entries
      BEFORE UPDATE ON public.time_entries
      FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
  END IF;
END$$;

ALTER TABLE IF EXISTS public.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.invitation_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.time_entries ENABLE ROW LEVEL SECURITY;

-- ROLES
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'roles' AND policyname = 'view_company_roles'
  ) THEN
    CREATE POLICY view_company_roles ON public.roles FOR SELECT
      USING (company_id = public.get_current_company_id());
  END IF;
END$$;

-- USER ROLES
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'user_roles' AND policyname = 'view_company_user_roles'
  ) THEN
    CREATE POLICY view_company_user_roles ON public.user_roles FOR SELECT
      USING (
        EXISTS (
          SELECT 1
          FROM public.users u
          JOIN public.roles r ON r.id = user_roles.role_id
          WHERE u.id = user_roles.user_id
            AND u.company_id = public.get_current_company_id()
            AND r.company_id = public.get_current_company_id()
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'user_roles' AND policyname = 'admins_manage_user_roles'
  ) THEN
    CREATE POLICY admins_manage_user_roles ON public.user_roles FOR ALL
      USING (public.is_company_admin())
      WITH CHECK (public.is_company_admin());
  END IF;
END$$;

-- INVITATIONS
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'invitations' AND policyname = 'view_company_invitations'
  ) THEN
    CREATE POLICY view_company_invitations ON public.invitations FOR SELECT
      USING (company_id = public.get_current_company_id());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'invitations' AND policyname = 'admins_create_invitations'
  ) THEN
    CREATE POLICY admins_create_invitations ON public.invitations FOR INSERT
      WITH CHECK (
        company_id = public.get_current_company_id()
        AND public.is_company_admin()
        AND invited_by = auth.uid()
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'invitations' AND policyname = 'admins_update_invitations'
  ) THEN
    CREATE POLICY admins_update_invitations ON public.invitations FOR UPDATE
      USING (company_id = public.get_current_company_id() AND public.is_company_admin())
      WITH CHECK (company_id = public.get_current_company_id() AND public.is_company_admin());
  END IF;
END$$;

-- INVITATION ROLES
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'invitation_roles' AND policyname = 'view_company_invitation_roles'
  ) THEN
    CREATE POLICY view_company_invitation_roles ON public.invitation_roles FOR SELECT
      USING (
        EXISTS (
          SELECT 1
          FROM public.invitations i
          WHERE i.id = invitation_roles.invitation_id
            AND i.company_id = public.get_current_company_id()
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'invitation_roles' AND policyname = 'admins_manage_invitation_roles'
  ) THEN
    CREATE POLICY admins_manage_invitation_roles ON public.invitation_roles FOR ALL
      USING (public.is_company_admin())
      WITH CHECK (public.is_company_admin());
  END IF;
END$$;

-- TIME ENTRIES
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'time_entries' AND policyname = 'view_time_entries_for_accessible_projects'
  ) THEN
    CREATE POLICY view_time_entries_for_accessible_projects ON public.time_entries FOR SELECT
      USING (
        company_id = public.get_current_company_id()
        AND public.has_project_access(project_id)
        AND (
          user_id = auth.uid()
          OR public.is_company_manager_or_admin()
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'time_entries' AND policyname = 'users_manage_own_time_entries'
  ) THEN
    CREATE POLICY users_manage_own_time_entries ON public.time_entries FOR ALL
      USING (
        company_id = public.get_current_company_id()
        AND user_id = auth.uid()
        AND public.has_project_access(project_id)
      )
      WITH CHECK (
        company_id = public.get_current_company_id()
        AND user_id = auth.uid()
        AND public.has_project_access(project_id)
      );
  END IF;
END$$;

-- Allow workers to tick off tasks on assigned projects
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'tasks' AND policyname = 'members_update_task_status'
  ) THEN
    CREATE POLICY members_update_task_status ON public.tasks FOR UPDATE
      USING (public.can_update_task_status(project_id))
      WITH CHECK (public.can_update_task_status(project_id));
  END IF;
END$$;
