import { AppPageShell } from "@/components/app-page-shell"
import { KunderClient } from "@/components/kunder/kunder-client"
import { Customer, CustomerProject } from "@/components/kunder/schema"
import { isActiveProject } from "@/app/prosjekter/project-utils"
import { getActiveAccountingProvider } from "@/lib/regnskap/registry"
import { getAdapter } from "@/lib/regnskap/registry"
import { createClient } from "@/lib/supabase/server"
import { getServerAuthContext } from "@/lib/auth/server-context"

type CustomerJobRow = {
  status: string
  payload: { customerId?: unknown } | null
  last_error_message: string | null
}

const PROVIDER_LABELS: Record<string, string> = { fiken: "Fiken", tripletex: "Tripletex" }

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

export default async function Page() {
  const supabase = await createClient()
  const user = (await getServerAuthContext())?.user ?? null
  
  // Hent kun kunder for den innloggede brukeren (RLS håndterer filtrering via company_id)
  let dbCustomers = []
  let customerLinks: Array<{ local_id: string; last_synced_at: string | null; external_url: string | null }> = []
  let customerJobs: CustomerJobRow[] = []
  let companyId: string | null = null
  let accountingProvider: string | null = null
  if (user) {
    // The company-id lookup and the (RLS-scoped) customers read are independent,
    // so run them concurrently instead of as a serial chain.
    const [{ data: userRow }, { data, error }] = await Promise.all([
      supabase
        .from("users")
        .select("company_id")
        .eq("id", user.id)
        .maybeSingle(),
      supabase
        .from("customers")
        .select("*, projects(id, name, status, budget_nok, start_date, end_date, updated_at), offers(id, status, amount_nok)")
        .order("name"),
    ])

    companyId = userRow?.company_id || null

    if (error) {
      console.error("Supabase Error fetching customers:", error)
    }

    dbCustomers = data || []

    if (companyId) {
      const active = await getActiveAccountingProvider(companyId)
      accountingProvider = active?.adapter.id ?? null
    }

    // Synk-data er kun relevant når et regnskapssystem faktisk er tilkoblet — og
    // det gjelder BEGGE. Før var dette hardkodet til Tripletex, så Fiken-kunder
    // så aldri om kundene deres var kommet frem.
    if (companyId && accountingProvider) {
      const adapter = getAdapter(accountingProvider as "fiken" | "tripletex")
      const entityTypes = adapter.storedEntityTypes("customer")
      const customerJobType = adapter.queueJobType("customer.upsert")

      const [{ data: links }, { data: jobs }] = await Promise.all([
        supabase
          .from("external_entity_links")
          .select("local_id,last_synced_at,external_url")
          .eq("company_id", companyId)
          .eq("provider", accountingProvider)
          .in("entity_type", entityTypes),
        supabase
          .from("integration_jobs")
          .select("status,payload,last_error_message")
          .eq("company_id", companyId)
          .eq("provider", accountingProvider)
          .eq("job_type", customerJobType || "customer.upsert")
          // Nyeste først: køen får en ny jobb per kunde hver natt, så det er den
          // siste som forteller hvordan det står til nå.
          .order("created_at", { ascending: false }),
      ])

      customerLinks = (links || []) as Array<{ local_id: string; last_synced_at: string | null; external_url: string | null }>
      customerJobs = (jobs || []) as CustomerJobRow[]
    }
  }

  const linkByCustomerId = new Map(customerLinks.map((link) => [link.local_id, link]))
  // Kun den NYESTE jobben per kunde teller. Før telte vi alle feilede jobber
  // noensinne, så én gammel feil ga «Krever handling» for alltid — selv om kunden
  // hadde blitt synket uten problemer hver natt siden.
  const latestJobByCustomerId = new Map<string, CustomerJobRow>()

  for (const job of customerJobs) {
    const customerId = job?.payload?.customerId
    if (!customerId || typeof customerId !== "string") continue
    if (!latestJobByCustomerId.has(customerId)) latestJobByCustomerId.set(customerId, job)
  }
  
  const customers = dbCustomers.map((c: any) => {
    const projects: CustomerProject[] = (c.projects || [])
      .map((p: any) => ({
        id: p.id,
        name: p.name || "Uten navn",
        status: p.status,
        budgetNok: p.budget_nok || 0,
        startDate: p.start_date,
        endDate: p.end_date,
        updatedAt: p.updated_at,
      }))
      .sort((a: CustomerProject, b: CustomerProject) => {
        const aTime = a.updatedAt ? new Date(a.updatedAt).getTime() : 0
        const bTime = b.updatedAt ? new Date(b.updatedAt).getTime() : 0
        return bTime - aTime
      })

    const activeProjects = projects.filter((p) => isActiveProject(p.status)).length
    const totalProjects = projects.length

    const offers = (c.offers || []) as Array<{ status: string | null; amount_nok: number | null }>
    const relevantOffers = offers.filter((offer) => offer.status && offer.status !== "draft")
    const acceptedOffers = relevantOffers.filter((offer) => offer.status === "accepted")
    const totalRevenue = acceptedOffers.reduce((sum, offer) => sum + (offer.amount_nok || 0), 0)
    const acceptanceRate =
      relevantOffers.length > 0 ? Math.round((acceptedOffers.length / relevantOffers.length) * 100) : 0
    
    const link = linkByCustomerId.get(c.id)
    const latestJob = latestJobByCustomerId.get(c.id)
    const syncFailed = latestJob ? ["failed", "dead_letter"].includes(latestJob.status) : false

    const syncStatus = syncFailed
      ? "attention"
      : latestJob && ["pending", "processing", "retry"].includes(latestJob.status)
        ? "syncing"
        : link
          ? "synced"
          : "none"

    return {
      id: c.id,
      type: c.org_number ? "bedrift" : "privatperson",
      name: c.name,
      email: c.email || "",
      phone: c.phone || "",
      orgNumber: c.org_number || "",
      address: c.address || "",
      postalCode: c.postal_code || "",
      city: c.city || "",
      activeProjects,
      totalProjects,
      totalRevenue,
      // Ingen reell kilde for sist-kontaktet enda. Sett tom verdi i stedet for
      // dagens dato, så vi ikke viser villedende data i kunde-skuffen.
      lastContact: "",
      acceptanceRate,
      syncStatus,
      syncErrorMessage: syncFailed ? latestJob?.last_error_message || null : null,
      syncLastSyncedAt: link?.last_synced_at || null,
      syncExternalUrl: link?.external_url || null,
      projects,
    } satisfies Customer
  })

  return (
    <AppPageShell segments={["Kunder"]}>
      <div className="flex flex-col gap-6 w-full min-w-0 max-w-full pb-8">
        <KunderClient
          initialData={customers}
          syncEnabled={Boolean(accountingProvider)}
          syncProviderLabel={accountingProvider ? PROVIDER_LABELS[accountingProvider] : undefined}
        />
      </div>
    </AppPageShell>
  )
}