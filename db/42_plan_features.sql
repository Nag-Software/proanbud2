-- 42_plan_features.sql
-- Worker-safe plan + module context for the current user's company.
--
-- Mini/Proff feature gating needs the plan_key and enabled modules available to
-- ALL company members (managers + workers), but the company_billing and
-- company_modules SELECT policies require is_company_manager_or_admin(). This
-- SECURITY DEFINER RPC bypasses those policies and returns only the minimal,
-- non-sensitive packaging info, scoped to the caller's own company.
--
-- Mirrors get_current_subscription_status() in 21_billing.sql.

CREATE OR REPLACE FUNCTION public.get_company_plan_context()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'plan_key', cb.plan_key,
    'status', COALESCE(cb.status, 'incomplete'),
    'enabled_modules', COALESCE(
      (SELECT array_agg(cm.module_key)
       FROM public.company_modules cm
       WHERE cm.company_id = public.get_current_company_id()),
      ARRAY[]::text[]
    )
  )
  FROM public.company_billing cb
  WHERE cb.company_id = public.get_current_company_id();
$$;

GRANT EXECUTE ON FUNCTION public.get_company_plan_context() TO authenticated;
