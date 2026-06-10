import { createAdminClient } from "@/lib/supabase/admin"

export async function assertCompanyHasModule(
  companyId: string | null | undefined,
  moduleKey: string,
  moduleLabel: string
): Promise<void> {
  if (!companyId || !(await companyHasModule(companyId, moduleKey))) {
    throw new Error(`${moduleLabel} er ikke aktivert. Gå til abonnement for å aktivere modulen.`)
  }
}

export async function companyHasModule(companyId: string, moduleKey: string): Promise<boolean> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from("company_modules")
    .select("module_key")
    .eq("company_id", companyId)
    .eq("module_key", moduleKey)
    .maybeSingle()

  if (error) {
    throw new Error(error.message)
  }

  return Boolean(data)
}

export async function getCurrentCompanyIdForUser(userId: string): Promise<string | null> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from("users")
    .select("company_id")
    .eq("id", userId)
    .maybeSingle()

  if (error) {
    throw new Error(error.message)
  }

  return data?.company_id ?? null
}
