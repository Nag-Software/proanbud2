-- 116_resend_crm_sync.sql
-- Siste tilstand vi har speilet til Resend (kontakter, segmenter, events).
--
-- lib/resend-crm/sync.ts sammenligner bedriftens nåværende tilstand med raden
-- her. Overganger (ny prøve, første tilbud sendt, prøve utløpt, betalt,
-- avsluttet) blir til events i Resend, som starter automatiseringene. Uten
-- denne raden ville hver synk sett «ny bedrift» og sendt velkomst på nytt.
--
-- ever_paid er klebrig: når en bedrift først har betalt, er en senere
-- kansellering «avsluttet», ikke «utløpt prøve».
--
-- Skrives og leses kun av serveren med service role — RLS er på uten
-- policies (deny-all).
--
-- Additiv: kan kjøres i prod før koden deployes. Safe to run repeatedly.

CREATE TABLE IF NOT EXISTS public.resend_contact_sync (
  company_id UUID PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  -- proeve | utlopt | betalende | avsluttet
  bucket TEXT NOT NULL CHECK (bucket IN ('proeve', 'utlopt', 'betalende', 'avsluttet')),
  has_sent_offer BOOLEAN NOT NULL DEFAULT false,
  ever_paid BOOLEAN NOT NULL DEFAULT false,
  -- Hash av kontaktfeltene sist sendt. Uendret hash + uendret bøtte = ingen API-kall.
  props_hash TEXT,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.resend_contact_sync ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.resend_contact_sync IS
  'Siste tilstand speilet til Resend per bedrift. Brukes til å utlede events ved overganger. Se lib/resend-crm/.';
