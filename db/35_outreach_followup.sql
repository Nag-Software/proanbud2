-- Follow-up sequences for the outbound lead engine ("kundemaskin").
-- The first cold email is step_index 0 (sent by /api/outreach/auto-send). Follow-ups
-- (steps 1..N) are sent automatically by the daily cron (/api/outreach/cron) to
-- prospects that are still in status 'kontaktet' (i.e. have not replied/converted/
-- opted out) after a configurable delay.
--
-- This migration only adds guards/indexes — no schema columns change. step_index and
-- the status enum already exist in db/31_outreach.sql.

-- ============================================================
-- Idempotency: at most one outreach row per (prospect, step).
-- The follow-up cron claims a step by inserting a 'queued' row with
-- ON CONFLICT DO NOTHING — this unique index is what makes that claim atomic,
-- so two overlapping cron runs can never double-send the same follow-up.
-- ============================================================
CREATE UNIQUE INDEX IF NOT EXISTS prospect_outreach_prospect_step_uniq
  ON public.prospect_outreach (prospect_id, step_index);

-- ============================================================
-- Supports the cron's "find prospects whose previous step was sent long enough
-- ago" query: filter by step_index + status, range-scan on sent_at.
-- ============================================================
CREATE INDEX IF NOT EXISTS prospect_outreach_step_status_sent_idx
  ON public.prospect_outreach (step_index, status, sent_at);
