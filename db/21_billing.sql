-- ==========================================
-- BILLING: Stripe subscriptions, usage, modules
-- ==========================================

CREATE TABLE IF NOT EXISTS public.company_billing (
  company_id UUID PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT UNIQUE,
  plan_key TEXT CHECK (plan_key IN ('mini', 'proff')),
  billing_interval TEXT CHECK (billing_interval IN ('month', 'year')),
  status TEXT NOT NULL DEFAULT 'incomplete'
    CHECK (status IN ('incomplete', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused')),
  trial_ends_at TIMESTAMPTZ,
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  quota_limit INTEGER NOT NULL DEFAULT 100,
  included_seats INTEGER NOT NULL DEFAULT 0,
  stripe_seat_subscription_item_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.company_modules (
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  module_key TEXT NOT NULL,
  enabled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  stripe_subscription_item_id TEXT,
  PRIMARY KEY (company_id, module_key)
);

CREATE TABLE IF NOT EXISTS public.company_usage_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL DEFAULT 'ai_tilbud',
  idempotency_key TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS public.billing_overage_snapshots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  stripe_invoice_id TEXT,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  quota_limit INTEGER NOT NULL,
  used_count INTEGER NOT NULL,
  overage_count INTEGER NOT NULL,
  unit_amount_ore INTEGER NOT NULL DEFAULT 950,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, period_start, period_end)
);

CREATE TABLE IF NOT EXISTS public.stripe_webhook_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_company_billing_status ON public.company_billing(status);
CREATE INDEX IF NOT EXISTS idx_company_usage_events_company_created
  ON public.company_usage_events(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_company_usage_events_period
  ON public.company_usage_events(company_id, event_type, created_at);

-- Quota limits by plan
CREATE OR REPLACE FUNCTION public.billing_quota_for_plan(p_plan_key TEXT)
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_plan_key
    WHEN 'mini' THEN 20
    WHEN 'proff' THEN 100
    ELSE 0
  END;
$$;

-- Active subscription check
CREATE OR REPLACE FUNCTION public.company_has_active_subscription(p_company_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.company_billing cb
    WHERE cb.company_id = p_company_id
      AND cb.status IN ('trialing', 'active')
  );
$$;

-- Usage summary for current billing period
CREATE OR REPLACE FUNCTION public.get_company_usage_summary(p_company_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_billing public.company_billing%ROWTYPE;
  v_period_start TIMESTAMPTZ;
  v_period_end TIMESTAMPTZ;
  v_used INTEGER;
  v_overage INTEGER;
  v_seat_count INTEGER;
  v_billable_seats INTEGER;
  v_chargeable_seats INTEGER;
BEGIN
  SELECT * INTO v_billing
  FROM public.company_billing
  WHERE company_id = p_company_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'has_billing', false,
      'status', 'incomplete',
      'plan_key', null,
      'billing_interval', null,
      'quota_limit', 0,
      'used', 0,
      'overage', 0,
      'period_start', null,
      'period_end', null,
      'trial_ends_at', null,
      'included_seats', 0,
      'seat_count', 0,
      'billable_seats', 0,
      'chargeable_seats', 0
    );
  END IF;

  v_period_start := COALESCE(v_billing.current_period_start, date_trunc('month', now()));
  v_period_end := COALESCE(v_billing.current_period_end, date_trunc('month', now()) + interval '1 month');

  SELECT COUNT(*)::INTEGER INTO v_used
  FROM public.company_usage_events e
  WHERE e.company_id = p_company_id
    AND e.event_type = 'ai_tilbud'
    AND e.created_at >= v_period_start
    AND e.created_at < v_period_end;

  v_overage := GREATEST(0, v_used - v_billing.quota_limit);

  SELECT COUNT(*)::INTEGER INTO v_seat_count
  FROM public.users u
  WHERE u.company_id = p_company_id
    AND COALESCE(u.is_active, true) = true;

  SELECT COUNT(*)::INTEGER INTO v_billable_seats
  FROM public.users u
  WHERE u.company_id = p_company_id
    AND COALESCE(u.is_active, true) = true
    AND u.role IN ('manager', 'worker');

  v_chargeable_seats := GREATEST(0, v_billable_seats - v_billing.included_seats);

  RETURN jsonb_build_object(
    'has_billing', true,
    'status', v_billing.status,
    'plan_key', v_billing.plan_key,
    'billing_interval', v_billing.billing_interval,
    'quota_limit', v_billing.quota_limit,
    'used', v_used,
    'overage', v_overage,
    'period_start', v_period_start,
    'period_end', v_period_end,
    'trial_ends_at', v_billing.trial_ends_at,
    'included_seats', v_billing.included_seats,
    'seat_count', v_seat_count,
    'billable_seats', v_billable_seats,
    'chargeable_seats', v_chargeable_seats,
    'stripe_customer_id', v_billing.stripe_customer_id,
    'stripe_subscription_id', v_billing.stripe_subscription_id
  );
END;
$$;

-- Record usage event (server-side only via service role in practice)
CREATE OR REPLACE FUNCTION public.record_usage_event(
  p_company_id UUID,
  p_event_type TEXT,
  p_idempotency_key TEXT,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_id UUID;
BEGIN
  INSERT INTO public.company_usage_events (company_id, event_type, idempotency_key, metadata)
  VALUES (p_company_id, p_event_type, p_idempotency_key, COALESCE(p_metadata, '{}'::jsonb))
  ON CONFLICT (company_id, idempotency_key) DO NOTHING
  RETURNING id INTO v_event_id;

  RETURN public.get_company_usage_summary(p_company_id)
    || jsonb_build_object('recorded', v_event_id IS NOT NULL);
END;
$$;

-- Module enabled check
CREATE OR REPLACE FUNCTION public.company_has_module(p_company_id UUID, p_module_key TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.company_modules cm
    WHERE cm.company_id = p_company_id
      AND cm.module_key = p_module_key
  );
$$;

-- RLS
ALTER TABLE public.company_billing ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_usage_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_overage_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stripe_webhook_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS company_billing_select ON public.company_billing;
DROP POLICY IF EXISTS company_modules_select ON public.company_modules;
DROP POLICY IF EXISTS company_usage_events_select ON public.company_usage_events;
DROP POLICY IF EXISTS billing_overage_snapshots_select ON public.billing_overage_snapshots;

CREATE POLICY company_billing_select ON public.company_billing
  FOR SELECT
  USING (
    company_id = public.get_current_company_id()
    AND public.is_company_manager_or_admin()
  );

CREATE POLICY company_modules_select ON public.company_modules
  FOR SELECT
  USING (
    company_id = public.get_current_company_id()
    AND public.is_company_manager_or_admin()
  );

CREATE POLICY company_usage_events_select ON public.company_usage_events
  FOR SELECT
  USING (
    company_id = public.get_current_company_id()
    AND public.is_company_manager_or_admin()
  );

CREATE POLICY billing_overage_snapshots_select ON public.billing_overage_snapshots
  FOR SELECT
  USING (
    company_id = public.get_current_company_id()
    AND public.is_company_manager_or_admin()
  );

-- Service role / webhooks write via admin client (bypasses RLS)

-- Current user's company subscription status (for middleware)
CREATE OR REPLACE FUNCTION public.get_current_subscription_status()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(cb.status, 'incomplete')
  FROM public.company_billing cb
  WHERE cb.company_id = public.get_current_company_id();
$$;

GRANT EXECUTE ON FUNCTION public.get_company_usage_summary(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.company_has_active_subscription(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.company_has_module(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_usage_event(UUID, TEXT, TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_current_subscription_status() TO authenticated;
