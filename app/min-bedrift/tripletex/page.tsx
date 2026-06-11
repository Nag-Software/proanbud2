import { AppPageShell } from "@/components/app-page-shell"
import { createClient } from "@/lib/supabase/server"
import { checkRoleAccess } from "@/lib/auth-utils"
import { getTripletexApiBaseUrl, TRIPLETEX_HELP_URL } from "@/lib/integrations/tripletex/config"

import { TripletexClient } from "./tripletex-client"

export default async function TripletexPage() {
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
    canManageIntegration = userRow?.role === "admin"
  }

  const [connectionResult, jobsResult, eventsResult] = companyId
    ? await Promise.all([
        supabase
          .from("tripletex_connections")
          .select("company_id, sync_state, session_expires_at, default_account_id, last_success_at, last_error_at, last_error_message, scope_config")
          .eq("company_id", companyId)
          .maybeSingle(),
        supabase
          .from("integration_jobs")
          .select("id, status, job_type, created_at, last_error_message")
          .eq("company_id", companyId)
          .eq("provider", "tripletex")
          .order("created_at", { ascending: false })
          .limit(15),
        supabase
          .from("integration_webhook_events")
          .select("id, event_type, process_status, received_at")
          .eq("company_id", companyId)
          .eq("provider", "tripletex")
          .order("received_at", { ascending: false })
          .limit(15),
      ])
    : [
        { data: null as any },
        { data: [] as any[] },
        { data: [] as any[] },
      ]

  return (
    <AppPageShell segments={["Min Bedrift", "Tripletex"]}>
      <div className="flex flex-col gap-6 pb-8">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Tripletex</h1>
          {getTripletexApiBaseUrl().includes("api-test.tripletex.tech") && (
            <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-900">
              Test
            </span>
          )}
        </div>

        <TripletexClient
          initialConnection={connectionResult.data}
          initialJobs={jobsResult.data || []}
          initialEvents={eventsResult.data || []}
          canManage={canManageIntegration}
          helpUrl={TRIPLETEX_HELP_URL}
        />
      </div>
    </AppPageShell>
  )
}
