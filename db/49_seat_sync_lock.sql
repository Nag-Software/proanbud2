-- ============================================================================
-- 49_seat_sync_lock.sql
-- ----------------------------------------------------------------------------
-- Per-company mutex for syncSeatQuantity (lib/billing/sync.ts).
--
-- Multiple unserialized callers (invite flow, Stripe subscription.updated webhook,
-- reconcile cron) could each observe zero seat items and each create one, producing
-- a temporary DOUBLE seat charge until the next run collapses the duplicates.
--
-- We acquire this lock with a conditional UPDATE (pooler-safe, unlike pg advisory
-- locks which don't survive PgBouncer transaction pooling) and a 2-minute stale
-- takeover so a crashed run can't hold it forever.
--
-- Idempotent: safe to re-run.
-- ============================================================================

ALTER TABLE public.company_billing
  ADD COLUMN IF NOT EXISTS seat_sync_locked_at TIMESTAMPTZ;
