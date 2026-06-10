-- Proff: admin + 5 ansatte inkludert; ekstra ansatte faktureres via Stripe seat add-on.

UPDATE public.company_billing
SET included_seats = 5, updated_at = now()
WHERE plan_key = 'proff';

UPDATE public.company_billing
SET included_seats = 0, updated_at = now()
WHERE plan_key = 'mini';

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
