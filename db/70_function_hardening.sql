-- 70: Funksjonsherding for skala og sikkerhet.
--
-- a) Pinner search_path=public på alle funksjoner som manglet det
--    (Supabase-lint «function_search_path_mutable»: en rolle-mutbar
--    search_path kan brukes til objekt-skygging mot SECURITY DEFINER).
--    search_path=public er trygt: kroppene refererer public-tabeller
--    ukvalifisert og auth.* alltid kvalifisert.
--
-- b) Trekker EXECUTE fra anon/authenticated på funksjoner som KUN kalles
--    server-side med service role (verifisert i koden: lib/integrations/*/jobs.ts,
--    app/api/affiliate/click, app/api/webhooks/resend, lib/billing/guards.ts).
--    RLS-hjelpefunksjonene beholder grants — de evalueres som spørrende rolle.

ALTER FUNCTION public.assigned_user_in_project_company(uuid, uuid) SET search_path = public;
ALTER FUNCTION public.billing_quota_for_plan(text) SET search_path = public;
ALTER FUNCTION public.bump_prospect_engagement(text, text) SET search_path = public;
ALTER FUNCTION public.can_manage_deviations(uuid) SET search_path = public;
ALTER FUNCTION public.can_manage_project(uuid) SET search_path = public;
ALTER FUNCTION public.can_manage_project_members(uuid) SET search_path = public;
ALTER FUNCTION public.can_update_task_status(uuid) SET search_path = public;
ALTER FUNCTION public.generate_deviation_reference(uuid) SET search_path = public;
ALTER FUNCTION public.get_current_company_id() SET search_path = public;
ALTER FUNCTION public.handle_updated_at() SET search_path = public;
ALTER FUNCTION public.has_project_access(uuid) SET search_path = public;
ALTER FUNCTION public.integration_claim_jobs(text, text, integer) SET search_path = public;
ALTER FUNCTION public.integration_mark_job_completed(bigint) SET search_path = public;
ALTER FUNCTION public.integration_mark_job_failed(bigint, text, text, boolean) SET search_path = public;
ALTER FUNCTION public.integration_mark_job_retry(bigint, text, text, timestamptz) SET search_path = public;
ALTER FUNCTION public.integration_reap_stuck_jobs(text, integer) SET search_path = public;
ALTER FUNCTION public.integration_release_worker_lock(text, text) SET search_path = public;
ALTER FUNCTION public.integration_try_acquire_worker_lock(text, text, integer) SET search_path = public;
ALTER FUNCTION public.is_company_admin() SET search_path = public;
ALTER FUNCTION public.is_company_manager_or_admin() SET search_path = public;
ALTER FUNCTION public.is_project_manager(uuid) SET search_path = public;
ALTER FUNCTION public.kjorebok_trips_same_company() SET search_path = public;
ALTER FUNCTION public.set_affiliate_partners_updated_at() SET search_path = public;
ALTER FUNCTION public.set_deviation_reference() SET search_path = public;
ALTER FUNCTION public.sync_user_full_name() SET search_path = public;

-- Server-only-funksjoner: fjern klient-EXECUTE, behold service role eksplisitt.
REVOKE EXECUTE ON FUNCTION public.integration_claim_jobs(text, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.integration_mark_job_completed(bigint) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.integration_mark_job_failed(bigint, text, text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.integration_mark_job_retry(bigint, text, text, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.integration_reap_stuck_jobs(text, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.integration_release_worker_lock(text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.integration_try_acquire_worker_lock(text, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.bump_affiliate_clicks(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.bump_prospect_engagement(text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.record_usage_event(uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_company_usage_summary(uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.integration_claim_jobs(text, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.integration_mark_job_completed(bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.integration_mark_job_failed(bigint, text, text, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.integration_mark_job_retry(bigint, text, text, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.integration_reap_stuck_jobs(text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.integration_release_worker_lock(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.integration_try_acquire_worker_lock(text, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.bump_affiliate_clicks(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.bump_prospect_engagement(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_usage_event(uuid, text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_company_usage_summary(uuid) TO service_role;
