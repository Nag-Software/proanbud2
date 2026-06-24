-- Performance-only indexes (speed audit, June 2026).
-- Pure additions: no schema or behaviour changes. Each is IF NOT EXISTS so the
-- migration is idempotent. Note: the migration runner wraps every file in a
-- transaction, so CREATE INDEX CONCURRENTLY is not used here. If any of these
-- tables has grown large in production, build the index manually with
-- CONCURRENTLY (outside a transaction) instead of relying on this file.

-- 2.1 Inbox loads all of a company's messages ordered by created_at. `messages`
-- previously had only idx_messages_offer_id, so this was a seq-scan + in-memory
-- sort on a continuously-growing, realtime table. The (company_id, created_at)
-- index also backs the company_id RLS predicate on every message read.
CREATE INDEX IF NOT EXISTS idx_messages_company_created
  ON public.messages (company_id, created_at);

-- 2.2 messages.customer_id is a NOT NULL FK with ON DELETE CASCADE and no index,
-- so deleting a customer seq-scans messages to cascade.
CREATE INDEX IF NOT EXISTS idx_messages_customer_id
  ON public.messages (customer_id);

-- 2.3 fetchSelgerCompanyTimeline filters seller_activity_log by target_id and
-- orders by created_at DESC (limit 100); target_id was unindexed. Partial index
-- keeps it small (most rows have a target_id, but the predicate matches the query).
CREATE INDEX IF NOT EXISTS idx_seller_activity_target_created
  ON public.seller_activity_log (target_id, created_at DESC)
  WHERE target_id IS NOT NULL;
