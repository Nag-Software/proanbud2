import { AppPageShell } from "@/components/app-page-shell"
import { KunderClient } from "@/components/kunder/kunder-client"
import { Customer } from "@/components/kunder/schema"
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
      .select("*, projects(id, status, budget_nok)")
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
    const projects = c.projects || [];
    
    // Antall aktive prosjekter
    const activeProjects = projects.filter((p: any) => 
      !['Avsluttet', 'Arkivert', 'Tilbud sendt'].includes(p.status)
    ).length;
    
    // Kalkuler total innbringende/budsjett eller fakturert.
    const totalRevenue = projects.reduce((sum: number, p: any) => sum + (p.budget_nok || 0), 0);
    
    // Beregn "akseptert" (tilbud akseptert vs sendt). 
    const totalOffers = projects.length;
    const acceptedOffers = projects.filter((p: any) => !['Tilbud sendt', 'Avslått', 'Avventer'].includes(p.status)).length;
    const acceptanceRate = totalOffers > 0 ? Math.round((acceptedOffers / totalOffers) * 100) : 0;
    
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
      totalRevenue,
      lastContact: new Date().toISOString(),
      acceptanceRate,
      syncStatus,
      syncLastSyncedAt: link?.last_synced_at || null,
      syncExternalUrl: link?.external_url || null,
    } as any
  })

  return (
    <AppPageShell segments={["Kunder"]}>
      <div className="flex flex-col gap-6 w-full min-w-0 max-w-full pb-8">
        <KunderClient initialData={customers} />
      </div>
    </AppPageShell>
  )
}