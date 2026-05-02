-- 09_tripletex_scope_extensions.sql
-- Add extended Tripletex data scopes and make them explicit in existing rows.

ALTER TABLE IF EXISTS public.tripletex_connections
  ALTER COLUMN scope_config SET DEFAULT '{"customers":true,"projects":true,"offers":true,"invoices":true,"employees":false,"calendar":false,"documents":false}'::jsonb;

UPDATE public.tripletex_connections
SET scope_config = coalesce(scope_config, '{}'::jsonb)
  || jsonb_build_object(
    'customers', coalesce((scope_config->>'customers')::boolean, true),
    'projects', coalesce((scope_config->>'projects')::boolean, true),
    'offers', coalesce((scope_config->>'offers')::boolean, true),
    'invoices', coalesce((scope_config->>'invoices')::boolean, true),
    'employees', coalesce((scope_config->>'employees')::boolean, false),
    'calendar', coalesce((scope_config->>'calendar')::boolean, false),
    'documents', coalesce((scope_config->>'documents')::boolean, false)
  );
