import { AppPageShell } from "@/components/app-page-shell"
import { checkRoleAccess } from "@/lib/auth-utils"
import { getCompanyTimeOverviewAction } from "@/app/timeforing/actions"
import { TimeforingClient } from "./timeforing-client"

export default async function Page() {
  await checkRoleAccess(["admin", "manager", "worker"])

  const overview = await getCompanyTimeOverviewAction()

  return (
    <AppPageShell segments={["Min bedrift", "Timeføring"]}>
      <div className="w-full mx-auto space-y-6">
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
            Arbeidstimer
          </p>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            Timeføring
          </h1>
          <p className="text-sm text-muted-foreground">
            Timer registreres automatisk når ansatte avslutter arbeid på et prosjekt.
          </p>
        </div>

        <TimeforingClient
          canViewAll={overview.canViewAll}
          totalHours={overview.totalHours}
          entries={overview.entries}
          byProject={overview.byProject}
          byEmployee={overview.byEmployee}
        />
      </div>
    </AppPageShell>
  )
}
