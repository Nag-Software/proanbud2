import { NextResponse } from "next/server"

import { isActiveSubscriptionStatus } from "@/lib/billing/plans"
import type { BillingStatus, UsageSummary } from "@/lib/billing/types"
import { isAdmin } from "@/lib/roles"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"

export type BillingContext = {
  userId: string
  companyId: string
  email: string
  fullName: string
  status: BillingStatus
  isActive: boolean
}

export async function getAuthenticatedCompanyContext(): Promise<
  | { ok: true; context: BillingContext }
  | { ok: false; response: NextResponse }
> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Du er ikke logget inn." }, { status: 401 }),
    }
  }

  const { data: userRow, error } = await supabase
    .from("users")
    .select("company_id, full_name, email")
    .eq("id", user.id)
    .maybeSingle()

  if (error || !userRow?.company_id) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Fant ikke aktiv Proanbud-bedrift for brukeren." },
        { status: 400 }
      ),
    }
  }

  const admin = createAdminClient()
  const { data: billing } = await admin
    .from("company_billing")
    .select("status")
    .eq("company_id", userRow.company_id)
    .maybeSingle()

  const status = (billing?.status ?? "incomplete") as BillingStatus

  return {
    ok: true,
    context: {
      userId: user.id,
      companyId: userRow.company_id,
      email: userRow.email || user.email || "",
      fullName: userRow.full_name || user.user_metadata?.full_name || user.email || "",
      status,
      isActive: isActiveSubscriptionStatus(status),
    },
  }
}

export async function requireCompanyAdmin(): Promise<
  | { ok: true; context: BillingContext }
  | { ok: false; response: NextResponse }
> {
  const result = await getAuthenticatedCompanyContext()
  if (!result.ok) return result

  const supabase = await createClient()
  const { data: userRow } = await supabase
    .from("users")
    .select("role")
    .eq("id", result.context.userId)
    .maybeSingle()

  if (!isAdmin(userRow?.role)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Kun administrator kan administrere abonnement." },
        { status: 403 }
      ),
    }
  }

  return result
}

export async function requireActiveSubscription(): Promise<
  | { ok: true; context: BillingContext }
  | { ok: false; response: NextResponse }
> {
  const result = await getAuthenticatedCompanyContext()
  if (!result.ok) return result

  if (!result.context.isActive) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: "Aktivt abonnement kreves. Gå til betaling for å starte eller fornye.",
          code: "subscription_required",
        },
        { status: 402 }
      ),
    }
  }

  return result
}

export async function requireModule(moduleKey: string): Promise<
  | { ok: true; context: BillingContext }
  | { ok: false; response: NextResponse }
> {
  const result = await requireActiveSubscription()
  if (!result.ok) return result

  const admin = createAdminClient()
  const { data } = await admin
    .from("company_modules")
    .select("module_key")
    .eq("company_id", result.context.companyId)
    .eq("module_key", moduleKey)
    .maybeSingle()

  if (!data) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: "Denne modulen er ikke aktivert på abonnementet ditt.",
          code: "module_required",
          module_key: moduleKey,
        },
        { status: 403 }
      ),
    }
  }

  return result
}

export async function getUsageSummary(companyId: string): Promise<UsageSummary> {
  const admin = createAdminClient()
  const { data, error } = await admin.rpc("get_company_usage_summary", {
    p_company_id: companyId,
  })

  if (error) {
    throw new Error(error.message)
  }

  return (data ?? {
    has_billing: false,
    status: "incomplete",
    quota_limit: 0,
    used: 0,
    overage: 0,
  }) as UsageSummary
}

export async function recordUsageEvent(input: {
  companyId: string
  eventType: string
  idempotencyKey: string
  metadata?: Record<string, unknown>
}): Promise<UsageSummary> {
  const admin = createAdminClient()
  const { data, error } = await admin.rpc("record_usage_event", {
    p_company_id: input.companyId,
    p_event_type: input.eventType,
    p_idempotency_key: input.idempotencyKey,
    p_metadata: input.metadata ?? {},
  })

  if (error) {
    throw new Error(error.message)
  }

  return data as UsageSummary
}
