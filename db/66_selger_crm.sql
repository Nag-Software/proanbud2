-- Ny salgskanal: /selger går fra auto-motor til manuelt, aktivitetsbasert CRM.
--
-- Én pipeline for hele reisen (kald lead → kontaktet → dialog → demo → trial →
-- kunde/tapt) med prospect-raden som kanonisk «deal». Motorens stegmaskin
-- (prospect_outreach) pensjoneres: sendte steg migreres inn i seller_email_log
-- som vanlige e-postrader (med tekst), deretter droppes tabellen.
--
-- ⚠️ Må kjøres FØR koden som fjerner motoren deployes — webhook/call-brief i
-- gammel kode leser prospect_outreach, ny kode leser de nye kolonnene.

-- ============================================================
-- 1) Status-enum: svar→dialog, avvist→tapt, + ny verdi 'trial'
--    ('ny' = innboks, 'kvalifisert' = pipelinens «Kald lead»-kolonne)
-- ============================================================
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.prospects'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%status%'
      AND pg_get_constraintdef(oid) NOT ILIKE '%enrichment_status%'
  LOOP
    EXECUTE format('ALTER TABLE public.prospects DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

UPDATE public.prospects SET status = 'dialog' WHERE status = 'svar';
UPDATE public.prospects SET status = 'tapt'   WHERE status = 'avvist';

ALTER TABLE public.prospects ADD CONSTRAINT prospects_status_check
  CHECK (status IN ('ny', 'kvalifisert', 'kontaktet', 'dialog', 'demo', 'trial', 'kunde', 'tapt'));

-- ============================================================
-- 2) Selvregistrerte firmaer som pipeline-kort: prospect-rader kan mangle
--    org.nr, og et firma skal aldri få mer enn én prospect-rad.
-- ============================================================
ALTER TABLE public.prospects ALTER COLUMN org_number DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS prospects_matched_company_uniq
  ON public.prospects (matched_company_id) WHERE matched_company_id IS NOT NULL;

-- ============================================================
-- 3) Aktivitets- og stegstempel (råtne-varsler beregnes fra disse, lagres aldri)
-- ============================================================
ALTER TABLE public.prospects
  ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS stage_entered_at TIMESTAMPTZ;

UPDATE public.prospects
SET last_activity_at = GREATEST(COALESCE(last_contacted_at, created_at), updated_at)
WHERE last_activity_at IS NULL;

UPDATE public.prospects
SET stage_entered_at = COALESCE(updated_at, created_at)
WHERE stage_entered_at IS NULL;

-- ============================================================
-- 4) Billing-backfill: firmaer som allerede er koblet får riktig steg
-- ============================================================
UPDATE public.prospects p
SET status = 'trial', updated_at = now()
FROM public.company_billing cb
WHERE cb.company_id = p.matched_company_id
  AND cb.status = 'trialing'
  AND p.status NOT IN ('kunde', 'tapt');

UPDATE public.prospects p
SET status = 'kunde', updated_at = now()
FROM public.company_billing cb
WHERE cb.company_id = p.matched_company_id
  AND cb.status IN ('active', 'past_due')
  AND p.status <> 'kunde';

-- ============================================================
-- 5) Oppgaver («neste handling») — maks ÉN åpen per lead, håndhevet i DB
-- ============================================================
CREATE TABLE IF NOT EXISTS public.prospect_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_id UUID NOT NULL REFERENCES public.prospects(id) ON DELETE CASCADE,
  task_type TEXT NOT NULL CHECK (task_type IN ('ring', 'epost', 'mote', 'annet')),
  title TEXT,
  due_at TIMESTAMPTZ NOT NULL,
  done_at TIMESTAMPTZ,
  done_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  note TEXT,
  assigned_to UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS prospect_tasks_due_open_idx
  ON public.prospect_tasks (due_at) WHERE done_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS prospect_tasks_one_open_uniq
  ON public.prospect_tasks (prospect_id) WHERE done_at IS NULL;
CREATE INDEX IF NOT EXISTS prospect_tasks_prospect_idx
  ON public.prospect_tasks (prospect_id, created_at DESC);

ALTER TABLE public.prospect_tasks ENABLE ROW LEVEL SECURITY;
-- Ingen policies: kun service-role / plattform-APIer (samme som prospects).

-- ============================================================
-- 6) E-posthistorikk per lead + tekst i loggen
-- ============================================================
ALTER TABLE public.seller_email_log
  ADD COLUMN IF NOT EXISTS prospect_id UUID REFERENCES public.prospects(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS subject TEXT,
  ADD COLUMN IF NOT EXISTS body TEXT;

CREATE INDEX IF NOT EXISTS seller_email_log_prospect_idx
  ON public.seller_email_log (prospect_id, created_at DESC)
  WHERE prospect_id IS NOT NULL;

-- Koble gamle motor-utsendelser til prospect via e-postadresse (best effort).
UPDATE public.seller_email_log l
SET prospect_id = p.id
FROM public.prospects p
WHERE l.prospect_id IS NULL
  AND l.template_id IN ('outreach-cold', 'outreach-followup')
  AND p.email IS NOT NULL
  AND lower(l.recipient_email) = lower(p.email);

-- Motor-æraen før e-postloggen fikk tracking: sendte steg som mangler loggrad
-- flyttes inn som e-postrader så tidslinjen beholder full historikk.
INSERT INTO public.seller_email_log (sent_by, template_id, recipient_email, prospect_id, subject, body, created_at)
SELECT
  po.approved_by,
  CASE WHEN po.step_index = 0 THEN 'outreach-cold' ELSE 'outreach-followup' END,
  COALESCE(lower(p.email), 'ukjent@proanbud.no'),
  po.prospect_id,
  po.ai_subject,
  po.ai_body,
  COALESCE(po.sent_at, po.updated_at)
FROM public.prospect_outreach po
JOIN public.prospects p ON p.id = po.prospect_id
WHERE po.status = 'sent'
  AND NOT EXISTS (
    SELECT 1 FROM public.seller_email_log l
    WHERE l.prospect_id = po.prospect_id
      AND l.template_id IN ('outreach-cold', 'outreach-followup')
      AND l.created_at BETWEEN COALESCE(po.sent_at, po.updated_at) - interval '15 minutes'
                           AND COALESCE(po.sent_at, po.updated_at) + interval '15 minutes'
  );

-- Tekst-backfill på loggrader som allerede fantes (motoren lagret teksten
-- i prospect_outreach, ikke i loggen).
UPDATE public.seller_email_log l
SET subject = po.ai_subject, body = po.ai_body
FROM public.prospect_outreach po
WHERE l.prospect_id = po.prospect_id
  AND l.subject IS NULL
  AND po.status = 'sent'
  AND po.sent_at IS NOT NULL
  AND l.created_at BETWEEN po.sent_at - interval '15 minutes'
                       AND po.sent_at + interval '15 minutes';

-- ============================================================
-- 7) bump_prospect_engagement: nye statusnavn i is_hot-logikken.
--    (Samme kropp som db/41 — kun statuslisten er endret, i samme migrasjon
--    som rename slik at webhooken aldri ser gamle navn.)
-- ============================================================
CREATE OR REPLACE FUNCTION public.bump_prospect_engagement(p_email text, p_kind text)
RETURNS TABLE (
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
LANGUAGE sql
AS $$
  update public.prospects p
  set
    open_count = p.open_count + (case when p_kind = 'open' then 1 else 0 end),
    click_count = p.click_count + (case when p_kind = 'click' then 1 else 0 end),
    is_hot = (
      (p.click_count + (case when p_kind = 'click' then 1 else 0 end)) >= 1
      or (p.open_count + (case when p_kind = 'open' then 1 else 0 end)) >= 2
      or p.status in ('dialog', 'demo', 'trial')
    ),
    hot_since = case
      when p.hot_since is null and (
        (p.click_count + (case when p_kind = 'click' then 1 else 0 end)) >= 1
        or (p.open_count + (case when p_kind = 'open' then 1 else 0 end)) >= 2
        or p.status in ('dialog', 'demo', 'trial')
      ) then now()
      else p.hot_since
    end,
    updated_at = now()
  where p.email = lower(trim(p_email))
  returning
    p.id, p.open_count, p.click_count, p.status,
    p.nace_code, p.nace_description, p.employee_count, p.email, p.last_contacted_at;
$$;

-- ============================================================
-- 8) Motorens stegmaskin fjernes (historikken er migrert i steg 6)
-- ============================================================
DROP TABLE IF EXISTS public.prospect_outreach;
