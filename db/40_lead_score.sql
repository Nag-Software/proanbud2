-- Lead scoring + engagement counters on prospects.
--
-- The seller cockpit ("I dag" / Pipeline) ranks everything by lead_score and the
-- hot-feed triggers on is_hot. The Resend webhook increments open_count/click_count
-- the moment a prospect engages, recomputes the score, and flips is_hot — so the
-- warmest leads float to the top of the seller's queue automatically.
--
-- All columns additive + nullable/defaulted — existing rows and inserts keep working.

alter table public.prospects
  add column if not exists lead_score integer not null default 0,
  add column if not exists lead_score_reason jsonb,
  add column if not exists open_count integer not null default 0,
  add column if not exists click_count integer not null default 0,
  add column if not exists is_hot boolean not null default false,
  add column if not exists hot_since timestamptz;

-- Lists sort by score; the hot-feed filters on is_hot.
create index if not exists prospects_lead_score_idx
  on public.prospects (lead_score desc);

create index if not exists prospects_is_hot_idx
  on public.prospects (is_hot)
  where is_hot;
