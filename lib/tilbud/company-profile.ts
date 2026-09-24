import type { SupabaseClient } from "@supabase/supabase-js"

import { DEFAULT_PRICING_MODEL, toSelectablePricingModel } from "@/lib/tilbud/offer-terms"
import { toContractBasis, type OfferCompanyContext, type OfferContractBasis, type OfferPricingModel } from "@/lib/tilbud/types"

export type CompanyPriceLevel = "low" | "normal" | "high"

export type CompanyProfile = {
  id: string
  name: string
  orgNumber: string
  logoUrl: string
  email: string
  phone: string
  address: string
  postalCode: string
  city: string
  website: string
  quoteValidityDays: number
  priceLevel: CompanyPriceLevel
  industry: string
  /** Registrert i Merverdiavgiftsregisteret — styrer mva på tilbud og vatType mot Fiken. */
  vatRegistered: boolean
}

export type CompanyProfileRow = {
  id: string
  name: string | null
  org_number: string | null
  logo_url?: string | null
  email?: string | null
  phone?: string | null
  address?: string | null
  postal_code?: string | null
  city?: string | null
  website?: string | null
  quote_validity_days?: number | null
  price_level?: CompanyPriceLevel | null
  industry?: string | null
  vat_registered?: boolean | null
}

export const COMPANY_PROFILE_SELECT =
  "id, name, org_number, logo_url, email, phone, address, postal_code, city, website, quote_validity_days, price_level, industry, vat_registered"

export const COMPANY_BASIC_SELECT = "id, name, org_number"

export const COMPANY_INDUSTRY_OPTIONS = [
  { value: "tomrer", label: "Tømrer / snekker" },
  { value: "rorlegger", label: "Rørlegger" },
  { value: "elektriker", label: "Elektriker" },
  { value: "maler", label: "Maler" },
  { value: "flislegger", label: "Flislegger" },
  { value: "totalentreprenor", label: "Totalentreprenør" },
  { value: "annet", label: "Annet" },
] as const

export const COMPANY_PRICE_LEVEL_OPTIONS = [
  { value: "low", label: "Lav" },
  { value: "normal", label: "Normal" },
  { value: "high", label: "Høy" },
] as const

export function mapCompanyRowToProfile(row: CompanyProfileRow): CompanyProfile {
  return {
    id: row.id,
    name: row.name?.trim() || "",
    orgNumber: row.org_number?.trim() || "",
    logoUrl: row.logo_url?.trim() || "",
    email: row.email?.trim() || "",
    phone: row.phone?.trim() || "",
    address: row.address?.trim() || "",
    postalCode: row.postal_code?.trim() || "",
    city: row.city?.trim() || "",
    website: row.website?.trim() || "",
    quoteValidityDays: Math.min(365, Math.max(1, Number(row.quote_validity_days || 30))),
    priceLevel: row.price_level === "low" || row.price_level === "high" ? row.price_level : "normal",
    industry: row.industry?.trim() || "",
    // Default true: matcher DB-defaulten og dagens oppførsel (alltid 25 %).
    vatRegistered: row.vat_registered !== false,
  }
}

export function mapCompanyRowToOfferContext(
  companyId: string,
  row: CompanyProfileRow | null | undefined
): OfferCompanyContext | null {
  if (!row) return null

  const profile = mapCompanyRowToProfile({ ...row, id: companyId })

  return {
    id: companyId,
    name: profile.name || null,
    orgNumber: profile.orgNumber || null,
    logoUrl: profile.logoUrl || null,
    email: profile.email || null,
    phone: profile.phone || null,
    address: profile.address || null,
    postalCode: profile.postalCode || null,
    city: profile.city || null,
    website: profile.website || null,
    quoteValidityDays: profile.quoteValidityDays,
    priceLevel: profile.priceLevel,
    industry: profile.industry || null,
    vatRegistered: profile.vatRegistered,
  }
}

export function normalizeRelatedCompanyRow<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) {
    return value[0] || null
  }

  return value || null
}

export async function fetchCompanyProfileRow(
  supabase: SupabaseClient,
  userId: string
): Promise<{ companyId: string; row: CompanyProfileRow; profileFieldsAvailable: boolean } | null> {
  const { data: userRow, error: userError } = await supabase
    .from("users")
    .select("company_id")
    .eq("id", userId)
    .maybeSingle()

  if (userError || !userRow?.company_id) {
    return null
  }

  const companyId = userRow.company_id

  const { data: fullRow, error: fullError } = await supabase
    .from("companies")
    .select(COMPANY_PROFILE_SELECT)
    .eq("id", companyId)
    .maybeSingle()

  if (!fullError && fullRow) {
    return { companyId, row: fullRow as CompanyProfileRow, profileFieldsAvailable: true }
  }

  // Fallback when profile migration (db/16) has not been applied yet.
  const { data: basicRow, error: basicError } = await supabase
    .from("companies")
    .select(COMPANY_BASIC_SELECT)
    .eq("id", companyId)
    .maybeSingle()

  if (basicError || !basicRow) {
    return null
  }

  return { companyId, row: basicRow as CompanyProfileRow, profileFieldsAvailable: false }
}

export async function fetchOfferCompanyContext(
  supabase: SupabaseClient,
  userId: string
): Promise<OfferCompanyContext | null> {
  const result = await fetchCompanyProfileRow(supabase, userId)
  if (!result) {
    return null
  }

  return mapCompanyRowToOfferContext(result.companyId, result.row)
}

export type CompanyOfferDefaults = {
  defaultPricingModel: OfferPricingModel
  defaultContractBasis: OfferContractBasis
}

export const FALLBACK_COMPANY_OFFER_DEFAULTS: CompanyOfferDefaults = {
  defaultPricingModel: DEFAULT_PRICING_MODEL,
  defaultContractBasis: "none",
}

/**
 * Standard prismodell/kontraktsgrunnlag for nye tilbud (db/96). Egen spørring —
 * ikke del av COMPANY_PROFILE_SELECT — fordi en manglende kolonne der får hele
 * profilen til å falle tilbake til bare navn og org.nr. Mangler kolonnene,
 * brukes standardverdiene. `available` sier om de kan lagres.
 */
export async function fetchCompanyOfferDefaults(
  supabase: SupabaseClient,
  companyId: string
): Promise<CompanyOfferDefaults & { available: boolean }> {
  const { data, error } = await supabase
    .from("companies")
    .select("default_pricing_model, default_contract_basis")
    .eq("id", companyId)
    .maybeSingle()

  if (error || !data) {
    return { ...FALLBACK_COMPANY_OFFER_DEFAULTS, available: false }
  }

  const row = data as { default_pricing_model?: string | null; default_contract_basis?: string | null }
  return {
    defaultPricingModel:
      toSelectablePricingModel(row.default_pricing_model as OfferPricingModel) ?? DEFAULT_PRICING_MODEL,
    defaultContractBasis: toContractBasis(row.default_contract_basis) ?? "none",
    available: true,
  }
}
