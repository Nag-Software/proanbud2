-- ============================================================================
-- 91: Salgsmaskin v2, fase 1 — research, dossier og godkjenningskø
--
-- Fase 0 (db/90) avgjorde HVEM vi lovlig kan kontakte. Fase 1 avgjør OM vi bør,
-- og HVA vi skal skrive. Tre nye ting:
--
--   prospects.pipeline_state   maskinens steg. `status` er fortsatt Caspers
--                              handelssteg (kanban), og røres ikke. Da slipper
--                              vi å endre status-enumen fra db/66.
--   prospect_research          ett dossier per researchkjøring: kilder, fakta,
--                              kroker med sitat, fit-kriterier og kostnad.
--   outreach_messages          godkjenningskøen OG treningskorpuset. KI-teksten
--                              og Caspers endelige tekst lagres side om side,
--                              sammen med avvisningsgrunnen, fra første utkast.
--
-- Det finnes ingen generisk jobbkø. Domenetabellene ER køene:
--   research-kø  = prospects.pipeline_state = 'venter_research'
--   sendekø      = outreach_messages.status = 'godkjent' and scheduled_for <= now()
-- Hver kø har én claim-funksjon med `for update skip locked`, lease og forsøk,
-- slik at to overlappende ticks aldri tar samme rad.
--
-- RLS på uten policies = kun service-role, som resten av salgstabellene.
-- Rent additiv.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Maskintilstand på prospektet
-- ---------------------------------------------------------------------------

alter table public.prospects
  add column if not exists pipeline_state text not null default 'kilde',
  add column if not exists fit_score smallint,
  add column if not exists fit_tier text,
  add column if not exists disqualify_reason text,
  add column if not exists research_id uuid,
  add column if not exists researched_at timestamptz,
  add column if not exists research_locked_at timestamptz,
  add column if not exists research_attempts smallint not null default 0,
  add column if not exists research_error text,
  add column if not exists snoozed_until timestamptz,
  add column if not exists tracking_token text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'prospects_pipeline_state_check') then
    alter table public.prospects add constraint prospects_pipeline_state_check
      check (pipeline_state in (
        'kilde',            -- importert, portene bestått, ikke køet enda
        'venter_research',  -- i research-køen
        'research',         -- research kjører (lease)
        'kvalifisert',      -- dossier med minst én validert krok
        'diskvalifisert',   -- ute, med grunn
        'for_tynn',         -- ingen validert krok — vi skriver ingen e-post
        'kun_telefon',      -- ingen lovlig e-postkanal
        'til_godkjenning',  -- utkast venter på Casper
        'i_sekvens',        -- steg 1 sendt
        'avsluttet',        -- sekvens ferdig uten svar
        'overlevert'        -- et menneske har tatt over (svar/klikk)
      ));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'prospects_fit_tier_check') then
    alter table public.prospects add constraint prospects_fit_tier_check
      check (fit_tier is null or fit_tier in ('A', 'B', 'C'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'prospects_fit_score_check') then
    alter table public.prospects add constraint prospects_fit_score_check
      check (fit_score is null or fit_score between 1 and 5);
  end if;
end $$;

-- Kort, tilfeldig token for ?r= i sporede lenker og for pluss-adressen i svar-til.
create unique index if not exists prospects_tracking_token_idx
  on public.prospects (tracking_token) where tracking_token is not null;

-- Research-køens oppslag: eldste ukøede først, per segment.
create index if not exists prospects_pipeline_state_idx
  on public.prospects (pipeline_state, segment);
create index if not exists prospects_research_queue_idx
  on public.prospects (created_at)
  where pipeline_state in ('venter_research', 'research');
create index if not exists prospects_snoozed_idx
  on public.prospects (snoozed_until) where snoozed_until is not null;

-- ---------------------------------------------------------------------------
-- 2) Dossieret
-- ---------------------------------------------------------------------------

create table if not exists public.prospect_research (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.prospects(id) on delete cascade,

  status text not null default 'ok'
    check (status in ('ok', 'feilet')),

  -- [{kind, url, ok, fetched_at}] — kind: brreg | roller | regnskap | nettside | places | sok
  sources jsonb not null default '[]'::jsonb,

  -- {brreg, regnskap, nettside:{tjenester,områder,referanser,sertifiseringer,
  --  verktøy,rekruttering,språk,skjema}, places}
  facts jsonb not null default '{}'::jsonb,

  -- [{id, type, text, quote, source_url, grounded}] — kun grounded=true brukes
  hooks jsonb not null default '[]'::jsonb,

  -- {kriterier:[{key, met, evidence, source_url}], score, tier}
  fit jsonb not null default '{}'::jsonb,

  pains jsonb not null default '[]'::jsonb,
  disqualifiers jsonb not null default '[]'::jsonb,
  best_angle text,
  summary text,

  verdict text not null default 'for_tynn'
    check (verdict in ('kvalifisert', 'diskvalifisert', 'for_tynn', 'kun_telefon')),

  -- Sidetekst beholdes så sitater kan kontrolleres på nytt. Kappes i koden.
  page_text text,

  model text,
  tokens_in integer,
  tokens_out integer,
  cost_usd numeric(10, 6),
  duration_ms integer,
  error text,

  created_at timestamptz not null default now()
);

create index if not exists prospect_research_prospect_idx
  on public.prospect_research (prospect_id, created_at desc);

alter table public.prospect_research enable row level security;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'prospects_research_id_fkey') then
    alter table public.prospects add constraint prospects_research_id_fkey
      foreign key (research_id) references public.prospect_research(id) on delete set null;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3) Godkjenningskøen og treningskorpuset
-- ---------------------------------------------------------------------------

create table if not exists public.outreach_messages (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.prospects(id) on delete cascade,
  research_id uuid references public.prospect_research(id) on delete set null,

  step smallint not null default 1 check (step between 1 and 3),
  kind text not null default 'kald' check (kind in ('kald', 'oppfolging', 'svar')),

  subject text not null,
  body_ai text not null,          -- KI-originalen, endres aldri
  body_final text,                -- Caspers endelige tekst (null = uendret)

  angle text,
  hook_id text,
  fact_ids text[] not null default '{}',

  lint jsonb not null default '{}'::jsonb,
  grade smallint,
  grade_report jsonb,

  status text not null default 'utkast'
    check (status in ('utkast', 'til_godkjenning', 'godkjent', 'planlagt',
                      'sendt', 'avvist', 'kansellert', 'feilet')),

  reject_reason text,
  reject_note text,
  edit_ratio numeric(5, 4),

  approved_by uuid references public.users(id) on delete set null,
  approved_at timestamptz,

  scheduled_for timestamptz,
  sent_at timestamptz,
  send_locked_at timestamptz,
  send_attempts smallint not null default 0,
  last_error text,

  rfc_message_id text,
  email_log_id uuid,

  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Idempotens: ett levende utkast per steg per prospekt.
create unique index if not exists outreach_messages_prospect_step_idx
  on public.outreach_messages (prospect_id, step)
  where status not in ('avvist', 'kansellert');

create index if not exists outreach_messages_send_queue_idx
  on public.outreach_messages (scheduled_for)
  where status in ('godkjent', 'planlagt');
create index if not exists outreach_messages_approval_queue_idx
  on public.outreach_messages (created_at)
  where status = 'til_godkjenning';
create index if not exists outreach_messages_prospect_idx
  on public.outreach_messages (prospect_id, created_at desc);

alter table public.outreach_messages enable row level security;

drop trigger if exists outreach_messages_set_updated_at on public.outreach_messages;
create trigger outreach_messages_set_updated_at
  before update on public.outreach_messages
  for each row execute function public.handle_updated_at();

-- ---------------------------------------------------------------------------
-- 4) Innstillinger (én rad) og tick-lease
-- ---------------------------------------------------------------------------

create table if not exists public.selger_settings (
  id text primary key default 'global' check (id = 'global'),

  -- Maskinen står i pause til Casper selv skrur den på.
  paused boolean not null default true,
  pause_reason text,
  paused_at timestamptz,

  -- {handverker: 'alt_manuelt' | 'oppfolging_auto', regnskapspartner: ...}
  approval_mode jsonb not null default
    '{"handverker":"alt_manuelt","regnskapspartner":"alt_manuelt"}'::jsonb,

  daily_cap smallint not null default 10,
  daily_new_drafts smallint not null default 20,
  draft_ttl_days smallint not null default 5,

  -- {dager:[1,2,3,4,5], fra:"07:30", til:"15:30", tz:"Europe/Oslo"}
  send_window jsonb not null default
    '{"dager":[1,2,3,4,5],"fra":"07:30","til":"15:30","tz":"Europe/Oslo"}'::jsonb,

  llm_daily_budget_usd numeric(8, 2) not null default 5.00,

  updated_at timestamptz not null default now()
);

insert into public.selger_settings (id) values ('global') on conflict (id) do nothing;

alter table public.selger_settings enable row level security;

drop trigger if exists selger_settings_set_updated_at on public.selger_settings;
create trigger selger_settings_set_updated_at
  before update on public.selger_settings
  for each row execute function public.handle_updated_at();

-- Én lease-rad per tick-type hindrer at to kjøringer overlapper.
create table if not exists public.selger_leases (
  name text primary key,
  locked_at timestamptz not null default now(),
  locked_until timestamptz not null,
  holder text
);

alter table public.selger_leases enable row level security;

-- ---------------------------------------------------------------------------
-- 5) Claim-funksjoner (security definer — kun service-role når RLS er tom)
-- ---------------------------------------------------------------------------

-- Tar research-jobber. Rader som har stått i 'research' i mer enn
-- p_lease_minutes tas tilbake (krasjet tick). Over 3 forsøk gir 'for_tynn'
-- med feilmelding, slik at maskinen aldri går i evig løkke på ett prospekt.
create or replace function public.claim_research_prospects(
  p_limit int default 5,
  p_lease_minutes int default 10,
  p_segment text default null
)
returns setof public.prospects
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return query
  update public.prospects p
     set pipeline_state = 'research',
         research_locked_at = now(),
         research_attempts = p.research_attempts + 1
   where p.id in (
     select c.id
       from public.prospects c
      where (
              c.pipeline_state = 'venter_research'
              or (c.pipeline_state = 'research'
                  and c.research_locked_at < now() - make_interval(mins => p_lease_minutes))
            )
        and c.research_attempts < 3
        and (p_segment is null or c.segment = p_segment)
      order by c.created_at
      limit p_limit
      for update skip locked
   )
  returning p.*;
end;
$$;

revoke all on function public.claim_research_prospects(int, int, text) from public, anon, authenticated;

-- Tar meldinger som er klare til sending.
create or replace function public.claim_sendable_messages(
  p_limit int default 5,
  p_lease_minutes int default 10
)
returns setof public.outreach_messages
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return query
  update public.outreach_messages m
     set send_locked_at = now(),
         send_attempts = m.send_attempts + 1
   where m.id in (
     select c.id
       from public.outreach_messages c
      where c.status in ('godkjent', 'planlagt')
        and coalesce(c.scheduled_for, now()) <= now()
        and (c.send_locked_at is null
             or c.send_locked_at < now() - make_interval(mins => p_lease_minutes))
        and c.send_attempts < 3
      order by coalesce(c.scheduled_for, c.created_at)
      limit p_limit
      for update skip locked
   )
  returning m.*;
end;
$$;

revoke all on function public.claim_sendable_messages(int, int) from public, anon, authenticated;

-- Tar tick-leasen. Returnerer false hvis en annen kjøring holder den.
create or replace function public.take_selger_lease(
  p_name text,
  p_seconds int default 300,
  p_holder text default null
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_taken boolean := false;
begin
  insert into public.selger_leases (name, locked_at, locked_until, holder)
  values (p_name, now(), now() + make_interval(secs => p_seconds), p_holder)
  on conflict (name) do update
    set locked_at = now(),
        locked_until = now() + make_interval(secs => p_seconds),
        holder = excluded.holder
  where public.selger_leases.locked_until < now()
  returning true into v_taken;

  return coalesce(v_taken, false);
end;
$$;

revoke all on function public.take_selger_lease(text, int, text) from public, anon, authenticated;

create or replace function public.release_selger_lease(p_name text)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.selger_leases set locked_until = now() - interval '1 second' where name = p_name;
$$;

revoke all on function public.release_selger_lease(text) from public, anon, authenticated;
