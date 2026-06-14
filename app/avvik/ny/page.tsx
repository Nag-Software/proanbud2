import { Suspense } from "react"

import { AppPageShell } from "@/components/app-page-shell"
import { NewDeviationForm } from "@/app/avvik/ny/new-deviation-form"
import { checkRoleAccess } from "@/lib/auth-utils"

export const dynamic = "force-dynamic"

export default async function NewAvvikPage() {
  await checkRoleAccess(["admin", "manager", "worker"])

  return (
    <AppPageShell segments={["Avvik", "Meld avvik"]}>
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-semibold">Meld avvik</h1>
          <p className="text-sm text-muted-foreground">
            Registrer RUH, HMS- eller KS-avvik med bilde og tekst
          </p>
        </div>
        <Suspense>
          <NewDeviationForm />
        </Suspense>
      </div>
    </AppPageShell>
  )
}
