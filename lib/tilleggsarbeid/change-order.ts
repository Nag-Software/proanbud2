import { createAdminClient } from "@/lib/supabase/admin"
import { generatePublicOfferSlug } from "@/lib/tilbud/public-offer"
import { APP_BASE_URL } from "@/lib/constants"

export type ChangeOrderBillingType = "fixed" | "hourly"
export type ChangeOrderStatus = "draft" | "sent" | "accepted" | "rejected"

export type ChangeOrder = {
  id: string
  offer_id: string | null
  project_id: string | null
  title: string
  description: string | null
  amount_nok: number
  billing_type: ChangeOrderBillingType
  hourly_rate_nok: number | null
  estimated_hours: number | null
  status: ChangeOrderStatus
  public_slug: string | null
  sent_at: string | null
  customer_responded_at: string | null
  created_at: string
  // Fra db/100 – mangler før migrasjonen er kjørt.
  recipient_email?: string | null
  reminder_sent_at?: string | null
  accepted_by_name?: string | null
  approval_basis?: string | null
  approval_note?: string | null
}

export function buildPublicChangeOrderUrl(slug: string) {
  return `${APP_BASE_URL}/tilleggsarbeid/${slug}`
}

/** Race-sikret opprettelse av offentlig lenke (kopi av ensureOfferPublicSlug-mønsteret). */
export async function ensureChangeOrderPublicSlug(changeOrderId: string, companyId: string) {
  const admin = createAdminClient()

  const { data: existing } = await admin
    .from("change_orders")
    .select("public_slug")
    .eq("id", changeOrderId)
    .eq("company_id", companyId)
    .maybeSingle()
  if (existing?.public_slug) return String(existing.public_slug)

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const slug = generatePublicOfferSlug()
    const { data } = await admin
      .from("change_orders")
      .update({ public_slug: slug, updated_at: new Date().toISOString() })
      .eq("id", changeOrderId)
      .eq("company_id", companyId)
      .is("public_slug", null)
      .select("public_slug")
      .maybeSingle()
    if (data?.public_slug) return String(data.public_slug)

    const { data: reloaded } = await admin
      .from("change_orders")
      .select("public_slug")
      .eq("id", changeOrderId)
      .maybeSingle()
    if (reloaded?.public_slug) return String(reloaded.public_slug)
  }
  throw new Error("Kunne ikke opprette offentlig lenke")
}

export type PublicChangeOrder = {
  id: string
  companyId: string
  projectId: string | null
  companyName: string
  title: string
  description: string | null
  amountNok: number
  billingType: ChangeOrderBillingType
  hourlyRateNok: number | null
  estimatedHours: number | null
  status: ChangeOrderStatus
  canRespond: boolean
  publicSlug: string
  /** Hvor engangskoden sendes: mottakeren ekstrajobben ble sendt til, ellers kundens e-post. */
  recipientEmail: string
  customerName: string
  acceptedByName: string | null
  respondedAt: string | null
  approvalBasis: string | null
  /**
   * Om prisen skal vises inkl. mva. Privatkunder (eller ukjent kunde) skal se
   * priser inkl. mva (prisopplysningsforskriften § 3); bedriftskunder eks. mva.
   */
  pricesInclVat: boolean
}

export async function fetchPublicChangeOrderBySlug(slug: string): Promise<PublicChangeOrder | null> {
  const admin = createAdminClient()
  const { data } = await admin
    .from("change_orders")
    // «*» tåler at kolonnene fra db/100 ikke finnes ennå.
    .select("*, companies(name)")
    .eq("public_slug", slug)
    .maybeSingle()
  if (!data) return null

  // Egne oppslag som tåler feil: skal ikke kunne gjøre varselet om til 404.
  const [{ data: customerRow }, { data: companyRow }] = await Promise.all([
    data.customer_id
      ? admin.from("customers").select("org_number, email, name").eq("id", data.customer_id as string).maybeSingle()
      : Promise.resolve({ data: null }),
    admin.from("companies").select("vat_registered").eq("id", data.company_id as string).maybeSingle(),
  ])
  const customer = customerRow as { org_number?: string | null; email?: string | null; name?: string | null } | null
  const isBusinessCustomer = Boolean(customer?.org_number?.trim())
  const row = data as Record<string, unknown>
  const vatRegistered = (companyRow as { vat_registered?: boolean | null } | null)?.vat_registered !== false

  const companies = (data as { companies?: { name: string | null } | { name: string | null }[] | null }).companies
  const company = Array.isArray(companies) ? companies[0] : companies
  const status = ((data.status as string) || "draft") as ChangeOrderStatus
  return {
    id: data.id as string,
    companyId: data.company_id as string,
    projectId: data.project_id as string | null,
    companyName: company?.name || "Bedriften",
    title: (data.title as string) || "Tilleggsarbeid",
    description: (data.description as string | null) ?? null,
    amountNok: Number(data.amount_nok || 0),
    billingType: ((data.billing_type as string) || "fixed") as ChangeOrderBillingType,
    hourlyRateNok:
      data.hourly_rate_nok === null || data.hourly_rate_nok === undefined
        ? null
        : Number(data.hourly_rate_nok),
    estimatedHours:
      data.estimated_hours === null || data.estimated_hours === undefined
        ? null
        : Number(data.estimated_hours),
    status,
    canRespond: status === "sent",
    publicSlug: slug,
    recipientEmail: String(row.recipient_email || customer?.email || "").trim(),
    customerName: String(customer?.name || "").trim(),
    acceptedByName: (row.accepted_by_name as string | null | undefined) ?? null,
    respondedAt: (row.customer_responded_at as string | null | undefined) ?? null,
    approvalBasis: (row.approval_basis as string | null | undefined) ?? null,
    pricesInclVat: vatRegistered && !isBusinessCustomer,
  }
}
