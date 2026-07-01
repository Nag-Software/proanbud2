import { AppPageShell } from "@/components/app-page-shell"
import { ModuleGate } from "@/components/billing/module-gate"
import {
  getCompanyTimeOverviewAction,
  getCompanyTrackingSettingsAction,
  getPendingApprovalsAction,
} from "@/app/timeforing/actions"
import { ApprovalsPanel } from "@/components/timeforing/approvals-panel"
import { AutoCloseSettings } from "@/components/timeforing/auto-close-settings"
import { checkRoleAccess } from "@/lib/auth-utils"
import { companyHasModule, getCurrentCompanyIdForUser } from "@/lib/billing/server-modules"
import { MODULE_PRICING } from "@/lib/billing/plans"
import { createClient } from "@/lib/supabase/server"
import { TimeforingClient } from "./timeforing-client"

export default async function Page() {
  await checkRoleAccess(["admin", "manager"])

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const companyId = user ? await getCurrentCompanyIdForUser(user.id) : null
  const hasTimeforing = companyId ? await companyHasModule(companyId, "timeforing") : false

  if (!hasTimeforing) {
    return (
      <AppPageShell segments={["Min bedrift", "Godkjenn timer"]}>
        <ModuleGate
          moduleName="Timeføring"
          monthlyPriceNok={MODULE_PRICING.timeforing}
          description="Registrer og følg arbeidstimer for ansatte og prosjekter."
        />
      </AppPageShell>
    )
  }

  const [overview, pending, trackingSettings] = await Promise.all([
    getCompanyTimeOverviewAction(),
    getPendingApprovalsAction(),
    getCompanyTrackingSettingsAction(),
  ])

  return (
    <AppPageShell segments={["Min bedrift", "Timeføring"]}>
      <div className="w-full mx-auto space-y-6">
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
            Arbeidstimer
          </p>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            Godkjenn timer
          </h1>
          <p className="text-sm text-muted-foreground">
            Timer registreres automatisk når ansatte avslutter arbeid på et prosjekt.
          </p>
        </div>

        <ApprovalsPanel initialPending={pending} />

        <TimeforingClient
          canViewAll={overview.canViewAll}
          totalHours={overview.totalHours}
          entries={overview.entries}
          byProject={overview.byProject}
          byEmployee={overview.byEmployee}
        />

        <AutoCloseSettings initial={trackingSettings} />
      </div>
    </AppPageShell>
  )
}
