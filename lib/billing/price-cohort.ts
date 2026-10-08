import { priceCohortForCompany, type PriceCohort } from "@/lib/billing/plans"
import { createAdminClient } from "@/lib/supabase/admin"

/**
 * Hvilken prisliste bedriften står på — se priceCohortForCompany i plans.ts.
 * Gammel pris krever både at bedriften ble opprettet før prisøkningen OG at
 * abonnementet fortsatt lever; en utløpt prøve starter på dagens pris.
 */
export async function getCompanyPriceCohort(companyId: string): Promise<PriceCohort> {
  const admin = createAdminClient()
  const [{ data: company }, { data: billing }] = await Promise.all([
    admin.from("companies").select("created_at").eq("id", companyId).maybeSingle(),
    admin.from("company_billing").select("status").eq("company_id", companyId).maybeSingle(),
  ])
  return priceCohortForCompany({
    createdAt: (company?.created_at as string | null) ?? null,
    billingStatus: (billing?.status as string | null) ?? null,
  })
}
