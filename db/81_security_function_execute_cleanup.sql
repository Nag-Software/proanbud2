-- 81: New functions receive EXECUTE for PUBLIC by default. Remove that grant
-- after creation; only the active-user RLS helper is callable by signed-in users.

REVOKE EXECUTE ON FUNCTION public.is_active_user() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_active_user() TO authenticated;

REVOKE EXECUTE ON FUNCTION public.enforce_message_tenant_consistency() FROM PUBLIC, anon, authenticated;
