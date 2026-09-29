import { AppPageShell } from "@/components/app-page-shell"
import { PlanGate } from "@/components/billing/plan-gate"
import { companyHasFeature } from "@/lib/billing/server-modules"
import { checkRoleAccess } from "@/lib/auth-utils"
import { CAPABILITIES, SCOPE_ITEMS } from "@/lib/regnskap/capabilities"
import { getActiveAccountingProvider } from "@/lib/regnskap/registry"
import { createAdminClient } from "@/lib/supabase/admin"

import { RegnskapClient } from "./regnskap-client"
import { getServerAuthContext } from "@/lib/auth/server-context"

/**
 * Felles regnskapsside.
 *
 * Selve TILKOBLINGEN gjøres fortsatt på /min-bedrift/fiken eller
 * /min-bedrift/tripletex — OAuth og API-nøkkel er reelt forskjellige, og det er to
 * ulike integrasjoner. Alt etter tilkoblingen er likt, og bor her: hva som synkes,
 * hvordan det går, og hva du gjør når noe stopper.
 */
export default async function RegnskapPage() {
  await checkRoleAccess(["Administrator", "Prosjektleder", "admin", "manager"])

  // Firma og RÅ users.role ligger allerede i den delte konteksten (samme rad,
  // samme RLS-klient som oppslaget som sto her før) — ingen ekstra runde.
  const context = await getServerAuthContext()
  const companyId = context?.companyId ?? null
  const canManage = context?.profileRole === "admin" || context?.profileRole === "manager"

  // Planveggen og tilkoblingsoppslaget er uavhengige — én runde, ikke to.
  // Tilkoblingen brukes bare hvis veggen slipper gjennom.
  const [hasIntegrations, active] = companyId
    ? await Promise.all([
        companyHasFeature(companyId, "integrasjoner"),
        getActiveAccountingProvider(companyId),
      ])
    : [false, null]

  if (!companyId || !hasIntegrations) {
    return (
      <AppPageShell segments={["Min bedrift", "Regnskap"]}>
        <PlanGate
          featureName="Integrasjoner"
          title="Integrasjoner er inkludert i Proff — eller som modul"
          description="Koble ProAnbud til Fiken eller Tripletex. Integrasjoner er inkludert i Proff, eller kan aktiveres som modul (29 kr/mnd) på Mini under abonnement."
        />
      </AppPageShell>
    )
  }

  let jobs: Array<Record<string, unknown>> = []
  if (active) {
    const admin = createAdminClient()
    const { data } = await admin
      .from("integration_jobs")
      .select("id, job_type, status, last_error_message, created_at, updated_at")
      .eq("company_id", companyId)
      .eq("provider", active.adapter.id)
      .order("created_at", { ascending: false })
      .limit(50)
    jobs = (data || []) as Array<Record<string, unknown>>
  }

  return (
    <AppPageShell segments={["Min bedrift", "Regnskap"]}>
      <RegnskapClient
        canManage={canManage}
        provider={active?.adapter.id ?? null}
        state={active?.state ?? null}
        capabilities={active ? CAPABILITIES[active.adapter.id] : null}
        scopeItems={SCOPE_ITEMS}
        initialJobs={jobs as never}
      />
    </AppPageShell>
  )
}
