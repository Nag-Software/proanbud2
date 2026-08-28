-- 80: Critical security hardening.
--
-- Removes destructive client-role privileges, makes employee deactivation an
-- effective database boundary, and enforces tenant consistency for messages.

-- Client roles only need Data API CRUD. TRUNCATE/TRIGGER/REFERENCES and broad
-- routine execution are not required by the application and bypass or enlarge
-- the RLS security boundary.
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon, authenticated;

REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;

REVOKE ALL PRIVILEGES ON ALL ROUTINES IN SCHEMA public FROM PUBLIC, anon, authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON ROUTINES FROM PUBLIC, anon, authenticated;

-- A user can update their display name through OAuth callbacks, but must never
-- be able to promote themselves, move tenant, or reactivate their own account.
REVOKE UPDATE ON public.users FROM anon, authenticated;
GRANT UPDATE (full_name) ON public.users TO authenticated;

CREATE OR REPLACE FUNCTION public.is_active_user()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users
    WHERE id = auth.uid()
      AND is_active IS TRUE
  );
$$;

CREATE OR REPLACE FUNCTION public.get_current_company_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT company_id
  FROM public.users
  WHERE id = auth.uid()
    AND is_active IS TRUE
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.is_company_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users
    WHERE id = auth.uid()
      AND role = 'admin'
      AND is_active IS TRUE
  );
$$;

-- Keep only the RPCs required by authenticated RLS policies and the signed-in
-- application. Server-only RPCs remain available through service_role.
GRANT EXECUTE ON FUNCTION public.is_active_user() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_current_company_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_company_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_company_manager_or_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_project_manager(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_project_access(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_project(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_project_members(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.assigned_user_in_project_company(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_deviations(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_update_task_status(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_company_plan_context() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_current_subscription_status() TO authenticated;

-- Add a restrictive active-user policy to every RLS-protected public table.
-- It composes with existing permissive tenant policies and does not grant any
-- access by itself.
DO $$
DECLARE
  target RECORD;
BEGIN
  FOR target IN
    SELECT n.nspname AS schema_name, c.relname AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND c.relrowsecurity
      AND c.relname <> 'users'
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS active_authenticated_user ON %I.%I',
      target.schema_name,
      target.table_name
    );
    EXECUTE format(
      'CREATE POLICY active_authenticated_user ON %I.%I AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT public.is_active_user())) WITH CHECK ((SELECT public.is_active_user()))',
      target.schema_name,
      target.table_name
    );
  END LOOP;
END
$$;

-- The users table also supports first-time self-bootstrap before a profile row
-- exists. Existing rows still require an active account.
DROP POLICY IF EXISTS active_authenticated_user ON public.users;
CREATE POLICY active_authenticated_user
ON public.users
AS RESTRICTIVE
FOR ALL
TO authenticated
USING ((SELECT public.is_active_user()))
WITH CHECK (
  (SELECT public.is_active_user())
  OR (
    id = (SELECT auth.uid())
    AND is_active IS TRUE
  )
);

CREATE OR REPLACE FUNCTION public.enforce_message_tenant_consistency()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.customers c
    WHERE c.id = NEW.customer_id
      AND c.company_id = NEW.company_id
  ) THEN
    RAISE EXCEPTION 'Message customer must belong to the same company'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.offer_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.offers o
    WHERE o.id = NEW.offer_id
      AND o.company_id = NEW.company_id
      AND o.customer_id = NEW.customer_id
  ) THEN
    RAISE EXCEPTION 'Message offer must belong to the same company and customer'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_message_tenant_consistency ON public.messages;
CREATE TRIGGER enforce_message_tenant_consistency
BEFORE INSERT OR UPDATE OF company_id, customer_id, offer_id
ON public.messages
FOR EACH ROW
EXECUTE FUNCTION public.enforce_message_tenant_consistency();

DROP POLICY IF EXISTS "Users can insert messages for their company" ON public.messages;
CREATE POLICY "Users can insert messages for their company"
ON public.messages
FOR INSERT
TO authenticated
WITH CHECK (
  company_id = (SELECT public.get_current_company_id())
  AND EXISTS (
    SELECT 1
    FROM public.customers c
    WHERE c.id = customer_id
      AND c.company_id = messages.company_id
  )
  AND (
    offer_id IS NULL
    OR EXISTS (
      SELECT 1
      FROM public.offers o
      WHERE o.id = offer_id
        AND o.company_id = messages.company_id
        AND o.customer_id = messages.customer_id
    )
  )
);
