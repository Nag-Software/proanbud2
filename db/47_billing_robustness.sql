-- ==========================================
-- 47_billing_robustness.sql
-- Stripe-drift hardening: cancel-state columns + status-aware access gating.
--
-- ⚠️ Run this BEFORE deploying the matching code. upsertCompanyBillingFromSubscription
-- now writes cancel_at_period_end / cancel_at, so the columns must exist first or
-- webhook sync will fail.
-- ==========================================

-- 1. Surface a portal/dashboard "cancel at period end" in the app so the user
--    sees a pending cancellation and we stop upselling/reminding them.
ALTER TABLE public.company_billing
  ADD COLUMN IF NOT EXISTS cancel_at_period_end BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cancel_at TIMESTAMPTZ;

-- 2. Module access must require a billable subscription — not merely the presence
--    of a company_modules row, which can outlive a lapsed subscription during
--    drift. Includes 'past_due' so a dunning company keeps access during the
--    card-retry grace period. Mirrors the server guard (hasBillableAccess).
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
    JOIN public.company_billing cb ON cb.company_id = cm.company_id
    WHERE cm.company_id = p_company_id
      AND cm.module_key = p_module_key
      AND cb.status IN ('trialing', 'active', 'past_due')
  );
$$;

-- 3. Worker-safe plan context: only expose plan_key/modules while the
--    subscription is billable (trialing/active/past_due), so client-side feature
--    gating matches the server and a lapsed company stops showing paid features
--    as available.
CREATE OR REPLACE FUNCTION public.get_company_plan_context()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'plan_key',
      CASE WHEN cb.status IN ('trialing', 'active', 'past_due') THEN cb.plan_key ELSE NULL END,
    'status', COALESCE(cb.status, 'incomplete'),
    'enabled_modules',
      CASE WHEN cb.status IN ('trialing', 'active', 'past_due') THEN COALESCE(
        (SELECT array_agg(cm.module_key)
         FROM public.company_modules cm
         WHERE cm.company_id = public.get_current_company_id()),
        ARRAY[]::text[]
      ) ELSE ARRAY[]::text[] END
  )
  FROM public.company_billing cb
  WHERE cb.company_id = public.get_current_company_id();
$$;

GRANT EXECUTE ON FUNCTION public.get_company_plan_context() TO authenticated;

-- 4. Expose cancel state in the usage summary so the billing page can show an
--    "Abonnementet avsluttes <dato>" banner. (Re-create with the two new fields.)
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
      'chargeable_seats', 0,
      'cancel_at_period_end', false,
      'cancel_at', null
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
    'cancel_at_period_end', COALESCE(v_billing.cancel_at_period_end, false),
    'cancel_at', v_billing.cancel_at,
    'stripe_customer_id', v_billing.stripe_customer_id,
    'stripe_subscription_id', v_billing.stripe_subscription_id
  );
END;
$$;
