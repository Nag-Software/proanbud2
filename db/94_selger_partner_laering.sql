-- ============================================================================
-- 94: Salgsmaskin v2, fase 4 — partnersegment, læring og sletting
--
-- Tre ting:
--
--   prospects.accountant_orgnr   regnskapsføreren fra Brønnøysund-rollen REGN.
--                                Aggregert over håndverkersegmentet blir dette
--                                den beste mållisten vi kan lage for
--                                partnersegmentet: kontorer som BEVISELIG har
--                                håndverkere som kunder, og som derfor faktisk
--                                kjenner problemet.
--   selger_weekly_reviews        KI-ens gjennomgang av Caspers redigeringer.
--                                Lagres som FORSLAG. Ingenting her tas i bruk
--                                automatisk.
--   slett_gamle_dossierer()      GDPR: dossierer for diskvalifiserte og
--                                ikke-svarende slettes etter 12 måneder.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Regnskapsføreren, til partnersegmentet
-- ---------------------------------------------------------------------------

alter table public.prospects
  add column if not exists accountant_orgnr text,
  add column if not exists accountant_name text;

create index if not exists prospects_accountant_idx
  on public.prospects (accountant_orgnr) where accountant_orgnr is not null;

-- ---------------------------------------------------------------------------
-- 2) Ukentlig gjennomgang (forslag, ikke vedtak)
-- ---------------------------------------------------------------------------

create table if not exists public.selger_weekly_reviews (
  id uuid primary key default gen_random_uuid(),
  segment text not null,
  sampled integer not null default 0,
  median_edit numeric(5, 4),
  summary text,
  -- [{pattern, suggestion, seen_in}]
  suggestions jsonb not null default '[]'::jsonb,
  -- Satt når Casper faktisk har tatt forslaget i bruk. Aldri av maskinen.
  applied_at timestamptz,
  applied_by uuid references public.users(id) on delete set null,
  cost_usd numeric(10, 6),
  created_at timestamptz not null default now()
);

create index if not exists selger_weekly_reviews_segment_idx
  on public.selger_weekly_reviews (segment, created_at desc);

alter table public.selger_weekly_reviews enable row level security;

-- ---------------------------------------------------------------------------
-- 3) Sletteregler (GDPR)
-- ---------------------------------------------------------------------------

-- Dossierer inneholder sidetekst og observasjoner om firmaer som aldri svarte.
-- Vi har ingen grunn til å beholde det i mer enn ett år. Suppresjonsraden
-- (outreach_unsubscribes) slettes ALDRI — den er hele poenget med å ha en
-- avmelding, og er unntatt fra sletting.
create or replace function public.slett_gamle_dossierer(p_months int default 12)
returns table (slettet_dossierer int, slettet_sidetekst int, slettet_svar int)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cutoff timestamptz := now() - make_interval(months => p_months);
  v_dossierer int := 0;
  v_sidetekst int := 0;
  v_svar int := 0;
begin
  -- 1) Hele dossieret for prospekter som er ute av bildet.
  with slettede as (
    delete from public.prospect_research r
    using public.prospects p
    where r.prospect_id = p.id
      and r.created_at < v_cutoff
      and p.pipeline_state in ('diskvalifisert', 'for_tynn', 'avsluttet')
      and p.status not in ('dialog', 'demo', 'trial', 'kunde')
    returning r.id
  )
  select count(*) into v_dossierer from slettede;

  -- 2) For dem som fortsatt er aktuelle, men gamle: behold dommen, kast
  --    sideteksten. Den er den tyngste og minst nyttige delen etter et år.
  with tommet as (
    update public.prospect_research
       set page_text = null
     where created_at < v_cutoff
       and page_text is not null
    returning id
  )
  select count(*) into v_sidetekst from tommet;

  -- 3) Innkommende e-post eldre enn fristen, der saken er ferdig.
  with slettede_svar as (
    delete from public.inbound_emails e
    using public.prospects p
    where e.prospect_id = p.id
      and e.received_at < v_cutoff
      and p.status = 'tapt'
    returning e.id
  )
  select count(*) into v_svar from slettede_svar;

  return query select v_dossierer, v_sidetekst, v_svar;
end;
$$;

revoke all on function public.slett_gamle_dossierer(int) from public, anon, authenticated;

-- Ved avmelding slettes alt om prospektet unntatt suppresjonsraden. Kalles av
-- avmeldingsruten, ikke av en cron — en avmelding skal virke med én gang.
create or replace function public.slett_ved_avmelding(p_prospect_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.prospect_research where prospect_id = p_prospect_id;
  delete from public.inbound_emails where prospect_id = p_prospect_id;
  update public.outreach_messages
     set body_ai = '[slettet ved avmelding]',
         body_final = null,
         grade_report = null,
         lint = '{}'::jsonb
   where prospect_id = p_prospect_id;
  update public.prospects
     set research_id = null,
         notes = null,
         disqualify_reason = 'avmeldt'
   where id = p_prospect_id;
end;
$$;

revoke all on function public.slett_ved_avmelding(uuid) from public, anon, authenticated;
