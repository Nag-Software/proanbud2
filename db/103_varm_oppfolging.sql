-- ============================================================================
-- 103: Varm oppfølging av analyse-leads
--
-- Tre ting henger sammen her:
--
--   1. Broen fra analyse_leads til prospekter fører regnskap over hva den har
--      gjort (bridged_at, prospect_id). Før dette stemplet den alle analyserte
--      firmaer som «aktive i dag» hver natt, så de så ferske ut for alltid og
--      aldri råtnet — og ingen så at de ikke var fulgt opp.
--   2. Samtykke. Skjemaet på proanbud.no/analyse har fått en avkrysning for
--      oppfølging på e-post. Samtykket (tidspunkt og ordlyden de faktisk så)
--      speiles fra Sanity og følger med over på prospektet, fordi det er
--      grunnlaget for å sende — ikke berettiget interesse (mfl. § 15). Uten
--      avkrysning lover skjemaet at e-posten bare brukes til eksempeltilbudet.
--   3. En egen, varm sekvens (outreach_messages.kind = 'varm'). Den har sin
--      egen unike indeks per steg, slik at et firma som har fått kald e-post
--      tidligere, likevel kan få den varme oppfølgingen etter at de kjørte
--      analysen.
--
-- Additivt for eksisterende kode: den unike indeksen for kald post gjenskapes
-- med nøyaktig samme dekning som før, og alle nye kolonner er valgfrie.
-- Kjøres FØR deploy — synken fra Sanity skriver de nye kolonnene.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) analyse_leads: samtykket og broens bokføring
-- ---------------------------------------------------------------------------

alter table public.analyse_leads
  add column if not exists follow_up_consent boolean not null default false,
  add column if not exists follow_up_consent_at timestamptz,
  -- Ordlyden ved siden av avkrysningen, slik den sto da de krysset av.
  -- Samtykket må kunne dokumenteres (GDPR art. 7 nr. 1).
  add column if not exists follow_up_consent_text text,
  add column if not exists prospect_id uuid references public.prospects(id) on delete set null,
  -- Når broen sist behandlet raden. Synken setter synced_at; er den nyere,
  -- har raden endret seg og skal behandles på nytt.
  add column if not exists bridged_at timestamptz,
  -- submitted_at slik den var da broen behandlet raden. En ny analyse fra
  -- samme e-post og domene gir ny submitted_at — det er en ny hendelse, ikke
  -- bare flere opplysninger om den gamle.
  add column if not exists bridged_submitted_at timestamptz;

-- ---------------------------------------------------------------------------
-- 2) prospects: samtykke og hvilken sekvens som går
-- ---------------------------------------------------------------------------

alter table public.prospects
  -- Adressen som ga samtykke. Kan være en annen enn prospects.email, som ofte
  -- er firmaets generelle adresse fra nettsiden.
  add column if not exists consent_email text,
  add column if not exists consent_at timestamptz,
  add column if not exists consent_text text,
  -- Analysen leadet sist kjørte — skrivemotoren henter jobben og summen herfra.
  add column if not exists analyse_lead_id text references public.analyse_leads(id) on delete set null,
  -- null = kald (alt som fantes før denne migrasjonen).
  add column if not exists sequence_kind text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'prospects_sequence_kind_check') then
    alter table public.prospects add constraint prospects_sequence_kind_check
      check (sequence_kind is null or sequence_kind in ('kald', 'varm'));
  end if;
  -- Et samtykke uten adresse er ikke et samtykke til noe.
  if not exists (select 1 from pg_constraint where conname = 'prospects_consent_email_check') then
    alter table public.prospects add constraint prospects_consent_email_check
      check (consent_at is null or consent_email is not null);
  end if;
end $$;

-- Svar og returer kommer inn på samtykkeadressen.
create index if not exists prospects_consent_email_idx
  on public.prospects (consent_email) where consent_email is not null;

-- Varm-køen: steg som forfaller.
create index if not exists prospects_warm_due_idx
  on public.prospects (sequence_next_at)
  where sequence_kind = 'varm' and sequence_stopped_at is null;

-- ---------------------------------------------------------------------------
-- 3) outreach_messages: den varme sekvensen
-- ---------------------------------------------------------------------------

alter table public.outreach_messages drop constraint if exists outreach_messages_kind_check;
alter table public.outreach_messages add constraint outreach_messages_kind_check
  check (kind in ('kald', 'oppfolging', 'svar', 'varm'));

-- Ett levende utkast per steg — nå per sekvens. Den gamle indeksen dekket alle
-- rader; den nye dekker alt unntatt 'varm', som før denne migrasjonen ikke fantes.
drop index if exists public.outreach_messages_prospect_step_idx;
create unique index if not exists outreach_messages_prospect_step_idx
  on public.outreach_messages (prospect_id, step)
  where status not in ('avvist', 'kansellert') and kind <> 'varm';
create unique index if not exists outreach_messages_prospect_warm_step_idx
  on public.outreach_messages (prospect_id, step)
  where status not in ('avvist', 'kansellert') and kind = 'varm';

-- ---------------------------------------------------------------------------
-- 4) Reparer stemplene broen skrev hver natt
--
-- last_activity_at og hot_since ble satt til «nå» ved hver kjøring. For
-- analyse-leads ingen har rørt, er sannheten tidspunktet for analysen. Leads
-- med kontakt, oppgaver eller e-post har ekte aktivitet og røres ikke.
-- ---------------------------------------------------------------------------

update public.prospects p
   set last_activity_at = a.submitted_at,
       hot_since = a.submitted_at
  from (
    select domain, max(submitted_at) as submitted_at
      from public.analyse_leads
     where coalesce(domain, '') <> '' and submitted_at is not null
     group by domain
  ) a
 where p.source = 'analyse'
   and p.domain = a.domain
   and p.last_contacted_at is null
   and not exists (select 1 from public.prospect_tasks t where t.prospect_id = p.id)
   and not exists (select 1 from public.seller_email_log l where l.prospect_id = p.id)
   and not exists (select 1 from public.outreach_messages m where m.prospect_id = p.id);
