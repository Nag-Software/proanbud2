import { AppPageShell } from "@/components/app-page-shell"
import { KunderClient } from "@/components/kunder/kunder-client"
import { Customer, CustomerProject } from "@/components/kunder/schema"
import { isActiveProject } from "@/app/prosjekter/project-utils"
import { createClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

export default async function Page() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  
  // Hent kun kunder for den innloggede brukeren (RLS håndterer filtrering via company_id)
  let dbCustomers = []
  let customerLinks: Array<{ local_id: string; last_synced_at: string | null; external_url: string | null }> = []
  let customerJobs: Array<{ status: string; payload: any }> = []
  let companyId: string | null = null
  if (user) {
    const { data: userRow } = await supabase
      .from("users")
      .select("company_id")
      .eq("id", user.id)
      .maybeSingle()

    companyId = userRow?.company_id || null

    const { data, error } = await supabase
      .from("customers")
      .select("*, projects(id, name, status, budget_nok, start_date, end_date, updated_at), offers(id, status, amount_nok, updated_at)")
      .order("name")
    
    if (error) {
      console.error("Supabase Error fetching customers:", error)
    }
    
    dbCustomers = data || []

    if (companyId) {
      const [{ data: links }, { data: jobs }] = await Promise.all([
        supabase
          .from("external_entity_links")
          .select("local_id,last_synced_at,external_url")
          .eq("company_id", companyId)
          .eq("provider", "tripletex")
          .eq("entity_type", "customer"),
        supabase
          .from("integration_jobs")
          .select("status,payload")
          .eq("company_id", companyId)
          .eq("provider", "tripletex")
          .eq("job_type", "customer.upsert"),
      ])

      customerLinks = (links || []) as Array<{ local_id: string; last_synced_at: string | null; external_url: string | null }>
      customerJobs = (jobs || []) as Array<{ status: string; payload: any }>
    }
  }

  const linkByCustomerId = new Map(customerLinks.map((link) => [link.local_id, link]))
  const jobStatusByCustomerId = new Map<string, { syncing: number; failed: number }>()

  for (const job of customerJobs) {
    const customerId = job?.payload?.customerId
    if (!customerId || typeof customerId !== "string") continue

    const prev = jobStatusByCustomerId.get(customerId) || { syncing: 0, failed: 0 }
    if (["pending", "processing", "retry"].includes(job.status)) prev.syncing += 1
    if (["failed", "dead_letter"].includes(job.status)) prev.failed += 1
    jobStatusByCustomerId.set(customerId, prev)
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

    const offers = (c.offers || []) as Array<{ status: string | null; amount_nok: number | null; updated_at: string | null }>
    const relevantOffers = offers.filter((offer) => offer.status && offer.status !== "draft")
    const acceptedOffers = relevantOffers.filter((offer) => offer.status === "accepted")
    const totalRevenue = acceptedOffers.reduce((sum, offer) => sum + (offer.amount_nok || 0), 0)
    const acceptanceRate =
      relevantOffers.length > 0 ? Math.round((acceptedOffers.length / relevantOffers.length) * 100) : 0
    
    // Utled "Sist kontaktet" fra faktisk aktivitet (nyeste prosjekt-/tilbud-oppdatering)
    const activityTimestamps = [
      ...projects.map((p) => (p.updatedAt ? new Date(p.updatedAt).getTime() : 0)),
      ...offers.map((o) => (o.updated_at ? new Date(o.updated_at).getTime() : 0)),
    ].filter((t) => t > 0)
    const lastContact =
      activityTimestamps.length > 0
        ? new Date(Math.max(...activityTimestamps)).toISOString()
        : null

    const link = linkByCustomerId.get(c.id)
    const jobState = jobStatusByCustomerId.get(c.id) || { syncing: 0, failed: 0 }

    const syncStatus = jobState.failed > 0
      ? "attention"
      : jobState.syncing > 0
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
      lastContact,
      notes: c.notes || null,
      acceptanceRate,
      syncStatus,
      syncLastSyncedAt: link?.last_synced_at || null,
      syncExternalUrl: link?.external_url || null,
      projects,
    } satisfies Customer
  })

  return (
    <AppPageShell segments={["Kunder"]}>
      <div className="flex flex-col gap-6 w-full min-w-0 max-w-full pb-8">
        <KunderClient initialData={customers} />
      </div>
    </AppPageShell>
  )
}