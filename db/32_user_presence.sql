-- ==========================================
-- USER PRESENCE (live active-user tracking)
-- Powers the Sjefen → Analyse operations map.
-- ==========================================

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;

-- Fast "who is active now" lookups (last_seen within the presence window).
CREATE INDEX IF NOT EXISTS idx_users_last_seen_at
  ON public.users (last_seen_at DESC)
  WHERE last_seen_at IS NOT NULL;
