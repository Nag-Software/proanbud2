import { AppPageShell } from "@/components/app-page-shell"
import { PlanGate } from "@/components/billing/plan-gate"
import { companyHasFeature } from "@/lib/billing/server-modules"
import { createClient } from "@/lib/supabase/server"
import { checkRoleAccess } from "@/lib/auth-utils"

import { FikenClient } from "./fiken-client"

// Fikens vanlige hjelpesider (ikke API-/utviklerdokumentasjonen fra
// FIKEN_HELP_URL i lib/integrations/fiken/config — den er for utviklere).
const FIKEN_HJELPESIDER_URL = "https://hjelp.fiken.no"

export default async function FikenPage() {
  await checkRoleAccess(["Administrator", "Prosjektleder", "admin", "manager"])
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  let companyId: string | null = null
  let canManageIntegration = false
  if (user) {
    const { data: userRow } = await supabase
      .from("users")
      .select("company_id, role")
      .eq("id", user.id)
      .maybeSingle()

    companyId = userRow?.company_id || null
    canManageIntegration = userRow?.role === "admin" || userRow?.role === "manager"
  }

  if (!companyId || !(await companyHasFeature(companyId, "integrasjoner"))) {
    return (
      <AppPageShell segments={["Min bedrift", "Fiken"]}>
        <PlanGate
          featureName="Integrasjoner"
          title="Integrasjoner er inkludert i Proff — eller som modul"
          description="Koble Proanbud til Fiken. Integrasjoner er inkludert i Proff, eller kan aktiveres som modul (29 kr/mnd) på Mini under abonnement."
        />
      </AppPageShell>
    )
  }

  const [connectionResult, tripletexResult] = companyId
    ? await Promise.all([
        supabase
          .from("fiken_connections")
          .select(
            "company_id, sync_state, token_expires_at, fiken_company_slug, fiken_company_name, is_test_company, last_success_at, last_error_at, last_error_message, last_payment_poll_date, scope_config, default_bank_account_number"
          )
          .eq("company_id", companyId)
          .maybeSingle(),
        supabase
          .from("tripletex_connections")
          .select("sync_state")
          .eq("company_id", companyId)
          .maybeSingle(),
      ])
    : ([{ data: null }, { data: null }] as const)

  const tripletexConnected = Boolean(
    tripletexResult.data && tripletexResult.data.sync_state !== "disconnected"
  )

  return (
    <AppPageShell segments={["Min bedrift", "Fiken"]}>
      <div className="flex flex-col gap-6 pb-8">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Fiken</h1>
          <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-900">
            Aktiv
          </span>
          {connectionResult.data?.is_test_company && (
            <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-900">
              Testselskap
            </span>
          )}
        </div>

        <FikenClient
          initialConnection={connectionResult.data}
          canManage={canManageIntegration}
          tripletexConnected={tripletexConnected && !connectionResult.data}
          helpUrl={FIKEN_HJELPESIDER_URL}
        />
      </div>
    </AppPageShell>
  )
}
