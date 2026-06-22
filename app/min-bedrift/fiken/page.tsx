import { AppPageShell } from "@/components/app-page-shell"
import { createClient } from "@/lib/supabase/server"
import { checkRoleAccess } from "@/lib/auth-utils"
import { FIKEN_HELP_URL } from "@/lib/integrations/fiken/config"

import { FikenClient } from "./fiken-client"

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

  const [connectionResult, jobsResult, tripletexResult] = companyId
    ? await Promise.all([
        supabase
          .from("fiken_connections")
          .select(
            "company_id, sync_state, token_expires_at, fiken_company_slug, fiken_company_name, is_test_company, last_success_at, last_error_at, last_error_message, last_payment_poll_date, scope_config"
          )
          .eq("company_id", companyId)
          .maybeSingle(),
        supabase
          .from("integration_jobs")
          .select("id, status, job_type, created_at, last_error_message")
          .eq("company_id", companyId)
          .eq("provider", "fiken")
          .order("created_at", { ascending: false })
          .limit(15),
        supabase
          .from("tripletex_connections")
          .select("sync_state")
          .eq("company_id", companyId)
          .maybeSingle(),
      ])
    : [{ data: null as any }, { data: [] as any[] }, { data: null as any }]

  const tripletexConnected = Boolean(
    tripletexResult.data && tripletexResult.data.sync_state !== "disconnected"
  )

  return (
    <AppPageShell segments={["Min Bedrift", "Fiken"]}>
      <div className="flex flex-col gap-6 pb-8">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Fiken</h1>
          <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-900">
            Beta
          </span>
          {connectionResult.data?.is_test_company && (
            <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-900">
              Testselskap
            </span>
          )}
        </div>

        <FikenClient
          initialConnection={connectionResult.data}
          initialJobs={jobsResult.data || []}
          canManage={canManageIntegration}
          tripletexConnected={tripletexConnected && !connectionResult.data}
          helpUrl={FIKEN_HELP_URL}
        />
      </div>
    </AppPageShell>
  )
}
