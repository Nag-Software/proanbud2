-- ============================================================================
-- 92: Salgsmaskin v2, fase 2 — svar-løkka
--
-- Uten dette hullet er hele maskinen halvferdig: et interessert svar kunne få
-- steg 2 og 3 likevel, fordi ingen kode leste innboksen til post@proanbud.no.
--
--   inbound_emails        innkommende meldinger som MATCHER et prospekt.
--                         post@ er en delt postkasse — alt annet ignoreres og
--                         lagres aldri. Det er både personvern og støyfjerning.
--   selger_inbox_cursor   hvor langt vi har lest per mappe. IMAP-UID-er er bare
--                         gyldige innenfor én uidvalidity; endrer serveren den,
--                         må vi starte på nytt, og da er markøren verdiløs.
--                         Derfor lagres begge deler sammen.
--
-- RLS på uten policies = kun service-role.
-- ============================================================================

create table if not exists public.inbound_emails (
  id uuid primary key default gen_random_uuid(),

  mailbox text not null,
  uid bigint not null,
  uidvalidity bigint,

  message_id text,
  in_reply_to text,
  "references" text,

  from_email text not null,
  from_name text,
  to_email text,
  subject text,
  text_body text,
  received_at timestamptz not null,

  prospect_id uuid references public.prospects(id) on delete set null,
  -- Hvordan vi koblet meldingen: pluss-token er eksakt, emne er en gjetning.
  match_method text
    check (match_method is null or match_method in
      ('plusstoken', 'in_reply_to', 'avsender', 'domene', 'emne', 'manuell')),

  classification text
    check (classification is null or classification in
      ('positiv', 'sporsmal', 'ikke_na', 'nei', 'avmelding',
       'feil_person', 'autosvar', 'ikke_levert', 'ukjent')),
  confidence numeric(4, 3),
  summary text,
  suggested_reply text,
  /** Returdato lest ut av et autosvar («tilbake 5. august»). */
  back_at timestamptz,

  handled_at timestamptz,
  handled_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Samme melding skal aldri behandles to ganger.
create unique index if not exists inbound_emails_mailbox_uid_idx
  on public.inbound_emails (mailbox, uid);
create index if not exists inbound_emails_prospect_idx
  on public.inbound_emails (prospect_id, received_at desc);
-- Caspers kø: svar som venter på et menneske.
create index if not exists inbound_emails_unhandled_idx
  on public.inbound_emails (received_at desc) where handled_at is null;

alter table public.inbound_emails enable row level security;

create table if not exists public.selger_inbox_cursor (
  mailbox text primary key,
  uidvalidity bigint,
  last_uid bigint not null default 0,
  last_run_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now()
);

alter table public.selger_inbox_cursor enable row level security;

-- Helsetall for leveringsdyktighet leses fra seller_email_log, som allerede har
-- delivered_at/bounced_at/complained_at (db/39). Ingen ny tabell trengs — bare
-- en indeks som gjør «de siste 50 sendingene» billig.
create index if not exists seller_email_log_recent_idx
  on public.seller_email_log (created_at desc);
