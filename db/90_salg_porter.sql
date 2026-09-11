-- ============================================================================
-- 90: Salgsmaskin v2, fase 0 — porter på prospektene
--
-- Grunnlaget for at maskinen bare skal kontakte firmaer som både er i
-- målgruppen og lovlig kan få kald e-post (markedsføringsloven § 15).
--
--   org_form          Brønnøysund-organisasjonsform (AS, ENK, NUF …)
--   founded_on        stiftelsesdato
--   vat_registered    registrert i mva-registeret
--   in_group          del av konsern
--   brreg_checked_at  sist hentet fra Brønnøysund (enhet + roller)
--   domain            firmaets registrerbare domene (fra nettside/e-post)
--   segment           salgssegment (lib/outreach/segments.ts)
--   trade             fag i SN2025 (lib/outreach/segments.ts resolveTrade)
--   email_source      hvor adressen kom fra — vi gjetter aldri post@domene
--   email_kind        hvem eier adressen (lib/outreach/gates.ts)
--   contact_policy    samlet dom: epost_ok / kun_telefon / utenfor_icp / blokkert
--   gate_reasons      maskinlesbare grunner (GATE_REASON_LABELS i gates.ts)
--   is_test           testprospekt — sendinger simuleres alltid
--
-- outreach_unsubscribes.domain: et «nei» fra ola@firma.no skal også stoppe
-- post@firma.no. Settes aldri for freemail-domener (gmail.com o.l.).
--
-- Rent additiv — ingen eksisterende rader endres, og de 39 avmeldingene står.
-- ============================================================================

alter table public.prospects
  add column if not exists org_form text,
  add column if not exists founded_on date,
  add column if not exists vat_registered boolean,
  add column if not exists in_group boolean,
  add column if not exists brreg_checked_at timestamptz,
  add column if not exists domain text,
  add column if not exists segment text not null default 'handverker',
  add column if not exists trade text,
  add column if not exists email_source text,
  add column if not exists email_kind text,
  add column if not exists contact_policy text not null default 'ukjent',
  add column if not exists gate_reasons text[] not null default '{}',
  add column if not exists is_test boolean not null default false;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'prospects_email_source_check') then
    alter table public.prospects add constraint prospects_email_source_check
      check (email_source is null or email_source in ('brreg', 'nettside', 'manuell', 'signup', 'analyse'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'prospects_email_kind_check') then
    alter table public.prospects add constraint prospects_email_kind_check
      check (email_kind is null or email_kind in
        ('generisk_firmadomene', 'firmanavn_freemail', 'personnavn', 'ukjent', 'ugyldig'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'prospects_contact_policy_check') then
    alter table public.prospects add constraint prospects_contact_policy_check
      check (contact_policy in ('ukjent', 'epost_ok', 'kun_telefon', 'utenfor_icp', 'blokkert'));
  end if;
end $$;

create index if not exists prospects_domain_idx
  on public.prospects (domain) where domain is not null;
create index if not exists prospects_contact_policy_idx
  on public.prospects (contact_policy);

alter table public.outreach_unsubscribes
  add column if not exists domain text;
create index if not exists outreach_unsubscribes_domain_idx
  on public.outreach_unsubscribes (domain) where domain is not null;
