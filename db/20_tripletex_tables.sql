-- 20_tripletex_patches.sql
-- Forutsetter at disse tabellene allerede finnes i databasen:
--   tripletex_connections, external_entity_links, integration_jobs, integration_webhook_events
--
-- RLS, indekser og jobb-RPC-er ligger i:
--   db/08_tripletex_integration.sql
--   db/09_tripletex_scope_extensions.sql
--
-- Denne filen legger kun til kolonner app-koden forventer, hvis de mangler. Trygt å kjøre på nytt.

ALTER TABLE IF EXISTS public.tripletex_connections
  ADD COLUMN IF NOT EXISTS default_vat_type_id BIGINT,
  ADD COLUMN IF NOT EXISTS default_account_id BIGINT,
  ADD COLUMN IF NOT EXISTS last_success_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_error_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_error_message TEXT;

ALTER TABLE IF EXISTS public.external_entity_links
  ADD COLUMN IF NOT EXISTS external_url TEXT,
  ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sync_status TEXT DEFAULT 'synced';
