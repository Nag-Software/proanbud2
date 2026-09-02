import { createAdminClient } from "@/lib/supabase/admin"
import { fetchAccountingLinks, pickLink } from "@/lib/regnskap/links"
import { getActiveAccountingProvider } from "@/lib/regnskap/registry"
import type { AccountingOfferStatus } from "@/lib/regnskap/types"

const EMPTY: AccountingOfferStatus = {
  connected: false,
  provider: null,
  customer: null,
  project: null,
  offer: null,
  order: null,
  invoice: null,
  pendingJobs: [],
}

/**
 * «Hvor er dette tilbudet i regnskapet?» — én form, uansett leverandør.
 *
 * Tripletex har et ordre-mellomledd som Fiken ikke har; feltet er da bare null.
 * Det er billigere enn to ulike statusformer som UI må kjenne hver for seg.
 */
export async function fetchOfferAccountingStatus(input: {
  companyId: string
  offerId: string
  customerId: string | null
  projectId: string | null
}): Promise<AccountingOfferStatus> {
  const active = await getActiveAccountingProvider(input.companyId)
  if (!active) return EMPTY

  const provider = active.adapter.id
  const localIds = [input.offerId, input.customerId, input.projectId].filter(Boolean) as string[]

  const admin = createAdminClient()
  const [links, pendingJobsResult] = await Promise.all([
    fetchAccountingLinks({ companyId: input.companyId, provider, localIds }),
    admin
      .from("integration_jobs")
      .select("job_type, status, last_error_message, payload")
      .eq("company_id", input.companyId)
      .eq("provider", provider)
      .in("status", ["pending", "processing", "retry"]),
  ])

  const pendingJobs = (pendingJobsResult.data || [])
    .filter((row) => {
      const payload = (row.payload || {}) as Record<string, unknown>
      return (
        String(payload.offerId || "") === input.offerId ||
        (input.customerId && String(payload.customerId || "") === input.customerId) ||
        (input.projectId && String(payload.projectId || "") === input.projectId)
      )
    })
    .map((row) => ({
      jobType: row.job_type as string,
      status: row.status as string,
      errorMessage: (row.last_error_message as string | null) || null,
    }))

  return {
    connected: true,
    provider,
    customer: input.customerId ? pickLink(links, provider, "customer", input.customerId) : null,
    project: input.projectId ? pickLink(links, provider, "project", input.projectId) : null,
    offer: pickLink(links, provider, "offer", input.offerId),
    order: pickLink(links, provider, "order", input.offerId),
    invoice: pickLink(links, provider, "invoice"),
    pendingJobs,
  }
}
