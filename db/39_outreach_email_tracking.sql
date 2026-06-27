-- Email engagement tracking for the outbound lead engine + trial reminders.
--
-- seller_email_log previously only recorded that an email was sent. To know what
-- actually WORKS (delivery, opens, clicks) we store the Resend provider message id
-- at send time and let the Resend webhook stamp engagement timestamps onto the row.
--
-- All columns are nullable and additive — existing rows and inserts keep working.

alter table public.seller_email_log
  add column if not exists provider_message_id text,
  add column if not exists delivered_at timestamptz,
  add column if not exists opened_at timestamptz,
  add column if not exists clicked_at timestamptz,
  add column if not exists bounced_at timestamptz,
  add column if not exists complained_at timestamptz,
  add column if not exists last_event_at timestamptz;

-- The webhook looks rows up by the Resend message id, so index it.
create index if not exists seller_email_log_provider_message_id_idx
  on public.seller_email_log (provider_message_id)
  where provider_message_id is not null;

-- Trial-reminder idempotency: we never want to send the same reminder template to
-- the same company twice. The reminder sender checks (company_id, template_id)
-- before sending; this index makes that check fast.
create index if not exists seller_email_log_company_template_idx
  on public.seller_email_log (company_id, template_id)
  where company_id is not null;
