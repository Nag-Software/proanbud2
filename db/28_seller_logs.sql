-- Seller activity and email logs for /selger dashboard

CREATE TABLE IF NOT EXISTS seller_activity_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  target_type text,
  target_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS seller_activity_log_created_at_idx
  ON seller_activity_log (created_at DESC);

CREATE INDEX IF NOT EXISTS seller_activity_log_seller_user_id_idx
  ON seller_activity_log (seller_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS seller_email_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sent_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  template_id text NOT NULL,
  recipient_email text NOT NULL,
  company_id uuid REFERENCES companies(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS seller_email_log_created_at_idx
  ON seller_email_log (created_at DESC);

ALTER TABLE seller_activity_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE seller_email_log ENABLE ROW LEVEL SECURITY;

-- No policies: only service role / platform APIs access these tables.
