-- ============================================================================
-- 104: Toveis synk med Attio
--
-- Casper jobber med leadene i Attio. Proanbud er fortsatt maskinen — research,
-- utkast, godkjenning og sending — men pipelinen, oppgavene og tidslinjen skal
-- ligge der han er.
--
-- Hvordan det henger sammen:
--
--   attio_outbox   ett prospekt per rad. Utløsere på prospects, oppgaver,
--                  e-postloggen, svar og aktivitetsloggen legger leadet i køen,
--                  uansett hvilken rute, cron eller maskin som gjorde endringen.
--                  Ingen kode trenger å huske på Attio.
--   attio_links    hva som allerede er sendt (notater og oppgaver), så en
--                  e-post aldri blir to notater.
--   prospects.attio_*  Attio-id-ene, og hvilket steg vi sist var enige om
--                  (attio_stage). Steget skrives bare til Attio når det endrer
--                  seg HER — ellers ville en gammel endring i køen overskrevet
--                  en deal Casper nettopp flyttet i Attio.
--
-- Bare «varme og aktive» leads synkes: analyse-leads, varme, alle vi har
-- kontaktet, og alt fra Kontaktet og utover. Ikke tusenvis av kalde firmaer
-- fra Brønnøysund som maskinen aldri har skrevet til.
--
-- Additivt. Uten ATTIO_SYNC=on i miljøet gjør koden ingenting med køen.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Koblingene på prospektet
-- ---------------------------------------------------------------------------

alter table public.prospects
  add column if not exists attio_company_id text,
  add column if not exists attio_person_id text,
  add column if not exists attio_deal_id text,
  -- Statusen vi sist var enige med Attio om. Endrer Proanbud statusen, skrives
  -- steget til Attio; flytter Casper dealen i Attio, oppdateres både status og
  -- denne — så endringen ikke sendes tilbake.
  add column if not exists attio_stage text,
  -- Hash av det vi sist skrev, så en uendret deal ikke skrives på nytt.
  add column if not exists attio_hash text,
  add column if not exists attio_synced_at timestamptz,
  add column if not exists attio_error text,
  -- Casper slettet dealen i Attio. Da skal vi ikke lage den igjen.
  add column if not exists attio_ignored boolean not null default false;

create unique index if not exists prospects_attio_deal_idx
  on public.prospects (attio_deal_id) where attio_deal_id is not null;

-- ---------------------------------------------------------------------------
-- 2) Hva som er sendt
-- ---------------------------------------------------------------------------

create table if not exists public.attio_links (
  -- 'epost' | 'svar' | 'aktivitet' | 'analyse' | 'oppgave'
  kind text not null,
  local_id text not null,
  prospect_id uuid references public.prospects(id) on delete cascade,
  attio_id text not null,
  -- Oppgaver: 'aapen' | 'ferdig', så en fullført oppgave bare meldes én gang.
  state text,
  created_at timestamptz not null default now(),
  primary key (kind, local_id)
);

create index if not exists attio_links_attio_idx on public.attio_links (attio_id);
create index if not exists attio_links_prospect_idx on public.attio_links (prospect_id);

alter table public.attio_links enable row level security;

-- ---------------------------------------------------------------------------
-- 3) Køen
-- ---------------------------------------------------------------------------

create table if not exists public.attio_outbox (
  prospect_id uuid primary key references public.prospects(id) on delete cascade,
  queued_at timestamptz not null default now(),
  locked_at timestamptz,
  attempts smallint not null default 0,
  last_error text
);

create index if not exists attio_outbox_queued_idx on public.attio_outbox (queued_at);

alter table public.attio_outbox enable row level security;

-- ---------------------------------------------------------------------------
-- 4) Innstillinger: webhooken og oppsettet
-- ---------------------------------------------------------------------------

alter table public.selger_settings
  add column if not exists attio_webhook_id text,
  -- Kryptert med lib/integrations/shared/crypto (AES-256-GCM), aldri i klartekst.
  add column if not exists attio_webhook_secret text,
  add column if not exists attio_deals_object_id text,
  add column if not exists attio_owner_member_id text,
  add column if not exists attio_setup_at timestamptz;

-- ---------------------------------------------------------------------------
-- 5) Legg i køen
-- ---------------------------------------------------------------------------

-- Et lead som ikke finnes (slettet, eller en aktivitetsrad som peker feil),
-- legges bare ikke i køen — det skal aldri bli en fremmednøkkelfeil.
create or replace function public.attio_enqueue(p_prospect_id uuid)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into public.attio_outbox (prospect_id, queued_at)
  select p_prospect_id, now()
   where exists (select 1 from public.prospects where id = p_prospect_id)
  on conflict (prospect_id) do update
    set queued_at = excluded.queued_at,
        attempts = 0,
        last_error = null;
$$;

revoke all on function public.attio_enqueue(uuid) from public, anon, authenticated;

-- Hvem skal til Attio? Samme regel som lib/attio/regler.ts (shouldSyncProspect).
create or replace function public.attio_skal_synkes(p public.prospects)
returns boolean
language sql
immutable
as $$
  select not coalesce(p.attio_ignored, false)
     and p.status <> 'ny'
     and (
       p.attio_deal_id is not null
       or p.source = 'analyse'
       or p.analyse_lead_id is not null
       or coalesce(p.is_hot, false)
       or p.last_contacted_at is not null
       or p.status in ('kontaktet', 'dialog', 'demo', 'trial', 'kunde')
     );
$$;

-- Køen er en bieffekt. Den skal ALDRI kunne stoppe en vanlig skriving til
-- leads, oppgaver eller loggene — derfor fanges alle feil og svelges her.
create or replace function public.attio_prospects_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.attio_skal_synkes(new) then
    return new;
  end if;

  if tg_op = 'INSERT' then
    perform public.attio_enqueue(new.id);
    return new;
  end if;

  -- Bare felt som vises i Attio. attio_* skrives av synken selv og skal ikke
  -- legge leadet i køen igjen.
  if (
      new.name, new.status, new.email, new.phone, new.domain, new.website,
      new.org_number, new.city, new.is_hot, new.last_contacted_at,
      new.analyse_lead_id, new.consent_email, new.matched_company_id,
      new.sequence_kind, new.sequence_step, new.sequence_stopped_at, new.trade
    ) is distinct from (
      old.name, old.status, old.email, old.phone, old.domain, old.website,
      old.org_number, old.city, old.is_hot, old.last_contacted_at,
      old.analyse_lead_id, old.consent_email, old.matched_company_id,
      old.sequence_kind, old.sequence_step, old.sequence_stopped_at, old.trade
    ) or (old.attio_ignored and not new.attio_ignored) then
    perform public.attio_enqueue(new.id);
  end if;

  return new;
exception when others then
  return new;
end;
$$;

drop trigger if exists attio_prospects_enqueue on public.prospects;
create trigger attio_prospects_enqueue
  after insert or update on public.prospects
  for each row execute function public.attio_prospects_trigger();

-- Barn av prospektet: oppgaver, e-post, svar, samtaler og notater.
create or replace function public.attio_child_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_prospect uuid;
begin
  if tg_table_name = 'seller_activity_log' then
    if new.target_type is distinct from 'prospect' or new.target_id is null then
      return new;
    end if;
    if new.action not in ('phone_call', 'note', 'won_prospect', 'lost_prospect', 'update_prospect_status') then
      return new;
    end if;
    v_prospect := new.target_id;
  else
    v_prospect := new.prospect_id;
  end if;

  if v_prospect is not null then
    perform public.attio_enqueue(v_prospect);
  end if;
  return new;
exception when others then
  return new;
end;
$$;

drop trigger if exists attio_tasks_enqueue on public.prospect_tasks;
create trigger attio_tasks_enqueue
  after insert or update on public.prospect_tasks
  for each row execute function public.attio_child_trigger();

drop trigger if exists attio_email_log_enqueue on public.seller_email_log;
create trigger attio_email_log_enqueue
  after insert on public.seller_email_log
  for each row execute function public.attio_child_trigger();

drop trigger if exists attio_inbound_enqueue on public.inbound_emails;
create trigger attio_inbound_enqueue
  after insert or update of prospect_id, classification on public.inbound_emails
  for each row execute function public.attio_child_trigger();

drop trigger if exists attio_activity_enqueue on public.seller_activity_log;
create trigger attio_activity_enqueue
  after insert on public.seller_activity_log
  for each row execute function public.attio_child_trigger();

-- ---------------------------------------------------------------------------
-- 6) Ta fra køen (for update skip locked + lease, som de andre køene)
-- ---------------------------------------------------------------------------

create or replace function public.claim_attio_outbox(
  p_limit int default 20,
  p_lease_seconds int default 120
)
returns table (prospect_id uuid, queued_at timestamptz, attempts smallint)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return query
  update public.attio_outbox o
     set locked_at = now(),
         attempts = o.attempts + 1
   where o.prospect_id in (
     select c.prospect_id
       from public.attio_outbox c
      where (c.locked_at is null
             or c.locked_at < now() - make_interval(secs => p_lease_seconds))
        and c.attempts < 8
      order by c.queued_at
      limit p_limit
      for update skip locked
   )
  returning o.prospect_id, o.queued_at, o.attempts;
end;
$$;

revoke all on function public.claim_attio_outbox(int, int) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7) Planlegging: hvert minutt, men bare når køen har noe
--
-- Samme mønster som db/93: CRON_SECRET leses fra Vault. Mangler den, lages
-- ingen jobb — legg den inn og kjør denne blokken på nytt. Ticken tømmer køen
-- også, så synken går (tregere) uten.
-- ---------------------------------------------------------------------------

do $$
declare
  v_secret text;
  v_base_url text;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron')
     or not exists (select 1 from pg_extension where extname = 'pg_net') then
    raise notice 'pg_cron/pg_net mangler — attio_sync planlegges ikke.';
    return;
  end if;

  select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = 'cron_secret' limit 1;

  v_base_url := coalesce(
    current_setting('app.settings.base_url', true),
    'https://app.proanbud.no'
  );

  if v_secret is null then
    raise notice 'cron_secret finnes ikke i Vault — attio_sync planlegges ikke. Legg den inn og kjør db/104 del 7 på nytt.';
    return;
  end if;

  perform cron.unschedule(jobid) from cron.job where jobname = 'attio_sync';

  perform cron.schedule(
    'attio_sync',
    '* * * * *',
    format(
      $cmd$
        select net.http_post(
          url := %L,
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', %L
          ),
          body := '{}'::jsonb,
          timeout_milliseconds := 60000
        )
        where exists (
          select 1 from public.attio_outbox
           where attempts < 8
             and (locked_at is null or locked_at < now() - interval '2 minutes')
        )
        -- Før Attio er satt opp fra /selger/innstillinger, er det ingen å sende til.
        and exists (
          select 1 from public.selger_settings where attio_setup_at is not null
        );
      $cmd$,
      v_base_url || '/api/cron/attio-sync',
      'Bearer ' || v_secret
    )
  );

  raise notice 'attio_sync planlagt hvert minutt mot %', v_base_url;
end $$;
