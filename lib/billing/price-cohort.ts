import { priceCohortFor, type PriceCohort } from "@/lib/billing/plans"
import { createAdminClient } from "@/lib/supabase/admin"

/** Hvilken prisliste bedriften står på — se priceCohortFor i plans.ts. */
export async function getCompanyPriceCohort(companyId: string): Promise<PriceCohort> {
  const admin = createAdminClient()
  const { data } = await admin
    .from("companies")
    .select("created_at")
    .eq("id", companyId)
    .maybeSingle()
  return priceCohortFor((data?.created_at as string | null) ?? null)
}
