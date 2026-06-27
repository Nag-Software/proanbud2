-- ==========================================
-- PROANBUD 2.0 - PROFESSIONAL SUPABASE SCHEMA (Idempotent)
-- ==========================================

-- Ensure extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ==========================================
-- 0. CLEANUP (For fresh install) -- Review before running
-- ==========================================
-- These DROPs are defensive: they remove old objects if present.
DROP TABLE IF EXISTS offers CASCADE;
DROP TABLE IF EXISTS tasks CASCADE;
DROP TABLE IF EXISTS project_members CASCADE;
DROP TABLE IF EXISTS projects CASCADE;
DROP TABLE IF EXISTS customers CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS companies CASCADE;

DROP TABLE IF EXISTS public.offers CASCADE;
DROP TABLE IF EXISTS public.tasks CASCADE;
DROP TABLE IF EXISTS public.project_members CASCADE;
DROP TABLE IF EXISTS public.projects CASCADE;
DROP TABLE IF EXISTS public.customers CASCADE;
DROP TABLE IF EXISTS public.users CASCADE;
DROP TABLE IF EXISTS public.companies CASCADE;

DROP FUNCTION IF EXISTS public.has_project_access CASCADE;
DROP FUNCTION IF EXISTS public.is_company_admin CASCADE;
DROP FUNCTION IF EXISTS public.get_current_company_id CASCADE;
DROP FUNCTION IF EXISTS public.handle_updated_at CASCADE;

-- ==========================================
-- 1. TABLES (single definitions, idempotent where appropriate)
-- ==========================================

-- COMPANIES (Tenants)
CREATE TABLE IF NOT EXISTS public.companies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  org_number TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- USERS (Extends auth.users)
-- Note: referencing auth.users requires that auth schema/table exists in the Supabase project
CREATE TABLE IF NOT EXISTS public.users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  role TEXT DEFAULT 'worker' CHECK (role IN ('admin', 'manager', 'worker')),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- CUSTOMERS
CREATE TABLE IF NOT EXISTS public.customers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  address TEXT,
  postal_code TEXT,
  city TEXT,
  org_number TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- PROJECTS
CREATE TABLE IF NOT EXISTS public.projects (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,

  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'planning',
  project_type TEXT NOT NULL DEFAULT 'nybygg',

  start_date DATE,
  end_date DATE,
  budget_nok INTEGER DEFAULT 0,

  description TEXT,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- PROJECT MEMBERS
CREATE TABLE IF NOT EXISTS public.project_members (
  project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  access_level TEXT DEFAULT 'read' CHECK (access_level IN ('read', 'write', 'manager')),
  assigned_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);

-- TASKS
CREATE TABLE IF NOT EXISTS public.tasks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,

  title TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'review', 'done')),
  priority TEXT DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),

  due_date TIMESTAMPTZ,
  assigned_to UUID REFERENCES public.users(id) ON DELETE SET NULL,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- OFFERS/BIDS
CREATE TABLE IF NOT EXISTS public.offers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,

  title TEXT NOT NULL,
  amount_nok INTEGER NOT NULL,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'accepted', 'rejected')),

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- USER PROFILES (for OAuth/profile data)
CREATE TABLE IF NOT EXISTS public.user_profiles (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  avatar_url TEXT,
  bio TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- CALENDAR INTEGRATIONS (store provider tokens)
CREATE TABLE IF NOT EXISTS public.calendar_integrations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  scope TEXT,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id, provider)
);

-- ==========================================
-- 2. FUNCTIONS & TRIGGERS (defined after tables)
-- ==========================================

-- handle_updated_at (trigger function)
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Fast helper function to get the current user's company_id
-- IMPORTANT: This function assumes an entry in public.users for auth.uid().
CREATE OR REPLACE FUNCTION public.get_current_company_id()
RETURNS UUID AS $$
  SELECT company_id
  FROM public.users
  WHERE id = auth.uid()
  LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Check if user has global admin role in their company
CREATE OR REPLACE FUNCTION public.is_company_admin()
RETURNS BOOLEAN AS $$
  SELECT CASE WHEN COUNT(*) = 0 THEN false ELSE (MAX(role) = 'admin') END
  FROM public.users
  WHERE id = auth.uid();
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Check if user has access to a specific project
CREATE OR REPLACE FUNCTION public.has_project_access(p_project_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  -- If user is admin in the company, they have access to all their company projects
  IF public.is_company_admin() THEN
    RETURN EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = p_project_id
      AND p.company_id = public.get_current_company_id()
    );
  END IF;

  -- Otherwise, user must be explicitly assigned to the project
  RETURN EXISTS (
    SELECT 1 FROM public.project_members pm
    WHERE pm.project_id = p_project_id
    AND pm.user_id = auth.uid()
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- Manager-on-project check, RLS-safe: SECURITY DEFINER bypasses the caller's RLS
-- so a policy ON project_members can call this WITHOUT self-recursion. (db/52
-- re-asserts this; defined here too so a fresh install is never recursive.)
CREATE OR REPLACE FUNCTION public.is_project_manager(p_project_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.project_members pm
    WHERE pm.project_id = p_project_id
      AND pm.user_id = auth.uid()
      AND pm.access_level = 'manager'
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ==========================================
-- 3. TRIGGERS (create only if not exists)
-- ==========================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_companies') THEN
    CREATE TRIGGER set_updated_at_companies BEFORE UPDATE ON public.companies FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_users') THEN
    CREATE TRIGGER set_updated_at_users BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_customers') THEN
    CREATE TRIGGER set_updated_at_customers BEFORE UPDATE ON public.customers FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_projects') THEN
    CREATE TRIGGER set_updated_at_projects BEFORE UPDATE ON public.projects FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_tasks') THEN
    CREATE TRIGGER set_updated_at_tasks BEFORE UPDATE ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_offers') THEN
    CREATE TRIGGER set_updated_at_offers BEFORE UPDATE ON public.offers FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_user_profiles') THEN
    CREATE TRIGGER set_updated_at_user_profiles BEFORE UPDATE ON public.user_profiles FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_calendar_integrations') THEN
    CREATE TRIGGER set_updated_at_calendar_integrations BEFORE UPDATE ON public.calendar_integrations FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
  END IF;
END$$;

-- ==========================================
-- 4. ROW LEVEL SECURITY (RLS)
-- ==========================================

-- Enable RLS across all tables (no-op if already enabled)
ALTER TABLE IF EXISTS public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.project_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.offers ENABLE ROW LEVEL SECURITY;

-- Enable RLS for new tables
ALTER TABLE IF EXISTS public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.calendar_integrations ENABLE ROW LEVEL SECURITY;

-- Policies created idempotently using DO blocks and pg_policies

-- 1. COMPANIES: Users can only see their own company
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'companies' AND policyname = 'view_own_company'
  ) THEN
    CREATE POLICY view_own_company ON public.companies FOR SELECT
      USING (id = public.get_current_company_id());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'companies' AND policyname = 'admin_update_own_company'
  ) THEN
    CREATE POLICY admin_update_own_company ON public.companies FOR UPDATE
      USING (id = public.get_current_company_id() AND public.is_company_admin());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'companies' AND policyname = 'create_companies'
  ) THEN
    CREATE POLICY create_companies ON public.companies FOR INSERT
      WITH CHECK (auth.uid() IS NOT NULL);
  END IF;
END$$;

-- 2. USERS: Users can see everyone in their company. Only admins can edit others.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'users' AND policyname = 'view_users_in_same_company'
  ) THEN
    CREATE POLICY view_users_in_same_company ON public.users FOR SELECT
      USING (company_id = public.get_current_company_id());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'users' AND policyname = 'admins_manage_users'
  ) THEN
    CREATE POLICY admins_manage_users ON public.users FOR ALL
      USING (company_id = public.get_current_company_id() AND public.is_company_admin());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'users' AND policyname = 'users_update_themselves'
  ) THEN
    CREATE POLICY users_update_themselves ON public.users FOR UPDATE
      USING (id = auth.uid());
  END IF;
END$$;

-- USER_PROFILES policies: owners manage their profile
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'user_profiles' AND policyname = 'owner_manage_profile'
  ) THEN
    CREATE POLICY owner_manage_profile ON public.user_profiles FOR ALL
      USING (user_id = auth.uid())
      WITH CHECK (user_id = auth.uid());
  END IF;
END$$;

-- CALENDAR_INTEGRATIONS policies: owners manage their integrations
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'calendar_integrations' AND policyname = 'owner_manage_integrations'
  ) THEN
    CREATE POLICY owner_manage_integrations ON public.calendar_integrations FOR ALL
      USING (user_id = auth.uid())
      WITH CHECK (user_id = auth.uid());
  END IF;
END$$;

-- 3. CUSTOMERS: Shared across the company
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'customers' AND policyname = 'view_company_customers'
  ) THEN
    CREATE POLICY view_company_customers ON public.customers FOR SELECT
      USING (company_id = public.get_current_company_id());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'customers' AND policyname = 'manage_company_customers'
  ) THEN
    CREATE POLICY manage_company_customers ON public.customers FOR ALL
      USING (company_id = public.get_current_company_id() AND (public.is_company_admin() OR (SELECT role FROM public.users WHERE id = auth.uid()) = 'manager'));
  END IF;
END$$;

-- 4. PROJECTS
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'projects' AND policyname = 'view_assigned_projects'
  ) THEN
    CREATE POLICY view_assigned_projects ON public.projects FOR SELECT
      USING (
        company_id = public.get_current_company_id()
        AND (
          public.is_company_admin()
          OR EXISTS (SELECT 1 FROM public.project_members pm WHERE pm.project_id = id AND pm.user_id = auth.uid())
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'projects' AND policyname = 'admins_and_managers_create_projects'
  ) THEN
    CREATE POLICY admins_and_managers_create_projects ON public.projects FOR INSERT
      WITH CHECK (company_id = public.get_current_company_id() AND (public.is_company_admin() OR (SELECT role FROM public.users WHERE id = auth.uid()) = 'manager'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'projects' AND policyname = 'manage_assigned_projects'
  ) THEN
    CREATE POLICY manage_assigned_projects ON public.projects FOR UPDATE
      USING (
        company_id = public.get_current_company_id()
        AND (
          public.is_company_admin()
          OR EXISTS (SELECT 1 FROM public.project_members pm WHERE pm.project_id = id AND pm.user_id = auth.uid() AND pm.access_level IN ('write', 'manager'))
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'projects' AND policyname = 'admins_delete_projects'
  ) THEN
    CREATE POLICY admins_delete_projects ON public.projects FOR DELETE
      USING (company_id = public.get_current_company_id() AND public.is_company_admin());
  END IF;
END$$;

-- 5. PROJECT MEMBERS
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'project_members' AND policyname = 'view_project_members_if_part_of_project'
  ) THEN
    CREATE POLICY view_project_members_if_part_of_project ON public.project_members FOR SELECT
      USING (public.has_project_access(project_id));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'project_members' AND policyname = 'admins_manage_project_assignments'
  ) THEN
    CREATE POLICY admins_manage_project_assignments ON public.project_members FOR ALL
      USING (public.is_company_admin() OR public.is_project_manager(project_id));
  END IF;
END$$;

-- 6. TASKS
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'tasks' AND policyname = 'view_tasks_for_accessible_projects'
  ) THEN
    CREATE POLICY view_tasks_for_accessible_projects ON public.tasks FOR SELECT
      USING (public.has_project_access(project_id));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'tasks' AND policyname = 'manage_tasks_for_accessible_projects'
  ) THEN
    CREATE POLICY manage_tasks_for_accessible_projects ON public.tasks FOR ALL
      USING (
        public.has_project_access(project_id)
        AND (
          public.is_company_admin()
          OR EXISTS (SELECT 1 FROM public.project_members pm WHERE pm.project_id = tasks.project_id AND pm.user_id = auth.uid() AND pm.access_level IN ('write', 'manager'))
        )
      );
  END IF;
END$$;

-- 7. OFFERS/BIDS
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'offers' AND policyname = 'view_offers_for_accessible_projects'
  ) THEN
    CREATE POLICY view_offers_for_accessible_projects ON public.offers FOR SELECT
      USING (public.has_project_access(project_id));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'offers' AND policyname = 'manage_offers'
  ) THEN
    CREATE POLICY manage_offers ON public.offers FOR ALL
      USING (
        company_id = public.get_current_company_id()
        AND (
          public.is_company_admin()
          OR EXISTS (SELECT 1 FROM public.project_members pm WHERE pm.project_id = offers.project_id AND pm.user_id = auth.uid() AND pm.access_level = 'manager')
        )
      );
  END IF;
END$$;

-- End of schema
