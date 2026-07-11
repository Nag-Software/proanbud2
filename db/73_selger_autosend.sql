-- ============================================================================
-- 73: Automatisk e-postsekvens på leads (selger-CRM)
--
-- Cron-drevet 3-stegs kald-sekvens fra post@proanbud.no erstatter den manuelle
-- «ring/skriv selv»-flyten som primærkanal. Sekvenstilstanden bor på prospektet:
--   sequence_step        0 = aldri sendt, 1..3 = siste sendte steg
--   sequence_next_at     når neste steg er klart for utsending (null = ingen)
--   sequence_stopped_at  satt når sekvensen er avsluttet (fullført/engasjert/
--                        avmeldt/videre i pipeline/bounce) — aldri gjenopptatt
--   sequence_stop_reason kort maskinlesbar årsak for dashboards/feilsøk
-- ============================================================================

alter table public.prospects
  add column if not exists sequence_step smallint not null default 0,
  add column if not exists sequence_next_at timestamptz,
  add column if not exists sequence_stopped_at timestamptz,
  add column if not exists sequence_stop_reason text;

-- Cronens due-oppslag: aktive sekvenser med e-post, sortert på forfall.
create index if not exists idx_prospects_sequence_due
  on public.prospects (sequence_next_at)
  where sequence_stopped_at is null and email is not null;
