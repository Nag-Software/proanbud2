-- Atomic prospect engagement bump for the Resend webhook.
--
-- Opens/clicks can arrive concurrently (and Resend retries), so a read-modify-write
-- in app code loses increments under races. This function increments the counters,
-- recomputes is_hot, and stamps hot_since on the cold→hot transition — all in a
-- single atomic UPDATE. The lead_score (which needs NACE→bransje mapping) is still
-- recomputed in app code afterwards; it's a derived display value, not a counter,
-- so last-writer-wins is fine there.

create or replace function public.bump_prospect_engagement(p_email text, p_kind text)
returns table (
  id uuid,
  open_count integer,
  click_count integer,
  status text,
  nace_code text,
  nace_description text,
  employee_count integer,
  email text,
  last_contacted_at timestamptz
)
language sql
as $$
  update public.prospects p
  set
    open_count = p.open_count + (case when p_kind = 'open' then 1 else 0 end),
    click_count = p.click_count + (case when p_kind = 'click' then 1 else 0 end),
    is_hot = (
      (p.click_count + (case when p_kind = 'click' then 1 else 0 end)) >= 1
      or (p.open_count + (case when p_kind = 'open' then 1 else 0 end)) >= 2
      or p.status in ('svar', 'demo')
    ),
    hot_since = case
      when p.hot_since is null and (
        (p.click_count + (case when p_kind = 'click' then 1 else 0 end)) >= 1
        or (p.open_count + (case when p_kind = 'open' then 1 else 0 end)) >= 2
        or p.status in ('svar', 'demo')
      ) then now()
      else p.hot_since
    end,
    updated_at = now()
  where p.email = lower(trim(p_email))
  returning
    p.id, p.open_count, p.click_count, p.status,
    p.nace_code, p.nace_description, p.employee_count, p.email, p.last_contacted_at;
$$;
