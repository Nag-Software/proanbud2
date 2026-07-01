import { AppPageShell } from "@/components/app-page-shell"
import { checkRoleAccess } from "@/lib/auth-utils"
import { logServerError } from "@/lib/errors/log"
import { createClient } from "@/lib/supabase/server"

import { TilbudListClient, type OfferListRow } from "./tilbud-list-client"

export const dynamic = "force-dynamic"
export const fetchCache = "force-no-store"
export const revalidate = 0

// Fornuftig tak i v1 — ingen paginering. Nyeste først, så de eldste som
// faller utenfor er de minst relevante.
const OFFER_LIMIT = 200

type RelatedCustomer = { name: string | null }

type OfferQueryRow = {
  id: string
  title: string | null
  status: string | null
  amount_nok: number | null
  created_at: string | null
  recipient_name: string | null
  customers: RelatedCustomer | RelatedCustomer[] | null
  projects:
    | { name: string | null; customers: RelatedCustomer | RelatedCustomer[] | null }
    | { name: string | null; customers: RelatedCustomer | RelatedCustomer[] | null }[]
    | null
}

// Supabase typer nested relasjoner som objekt eller array avhengig av
// kardinalitet — normaliser til én rad (samme mønster som tilbudsdetaljen).
function normalizeRelatedRow<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] || null
  return value || null
}

const VALID_STATUSES = ["draft", "sent", "accepted", "rejected"] as const

export default async function TilbudPage() {
  // Workers jobber ikke med tilbud — checkRoleAccess redirecter dem automatisk.
  const { user } = await checkRoleAccess(["admin", "manager"])

  const supabase = await createClient()

  // Eksplisitt company-scoping i tillegg til RLS
  // (view_offers_for_accessible_projects) — samme belte-og-bukser som
  // dashbordets tilbudsspørringer.
  const { data: userRow } = await supabase
    .from("users")
    .select("company_id")
    .eq("id", user.id)
    .maybeSingle()

  let offersQuery = supabase
    .from("offers")
    .select(
      "id, title, status, amount_nok, created_at, recipient_name, customers(name), projects(name, customers(name))"
    )
    .order("created_at", { ascending: false })
    .limit(OFFER_LIMIT)

  if (userRow?.company_id) {
    offersQuery = offersQuery.eq("company_id", userRow.company_id)
  }

  const { data, error } = await offersQuery

  if (error) {
    await logServerError({
      message: "Kunne ikke hente tilbudslisten",
      error,
      source: "server",
      route: "app/tilbud/page.tsx",
    })

    // Ikke vis «Ingen tilbud ennå»-onboardingen når spørringen feilet — det
    // ville lyve til brukere som faktisk har tilbud.
    return (
      <AppPageShell segments={["Tilbud"]}>
        <div className="flex w-full min-w-0 max-w-full flex-col gap-6 pb-8">
          <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed bg-card px-6 py-16 text-center">
            <p className="text-lg font-semibold text-foreground">
              Kunne ikke hente tilbudene
            </p>
            <p className="max-w-sm text-sm text-muted-foreground">
              Noe gikk galt hos oss. Prøv å laste siden på nytt — ta kontakt hvis
              det fortsetter.
            </p>
          </div>
        </div>
      </AppPageShell>
    )
  }

  const rows: OfferListRow[] = ((data || []) as OfferQueryRow[]).map((offer) => {
    const project = normalizeRelatedRow(offer.projects)
    const customer =
      normalizeRelatedRow(offer.customers) || normalizeRelatedRow(project?.customers)
    const status = VALID_STATUSES.includes(offer.status as (typeof VALID_STATUSES)[number])
      ? (offer.status as OfferListRow["status"])
      : "draft"

    return {
      id: offer.id,
      title: offer.title || "Uten tittel",
      shortId: `#${offer.id.slice(0, 8).toUpperCase()}`,
      customer: customer?.name || offer.recipient_name || "",
      project: project?.name || "",
      amountNok: offer.amount_nok || 0,
      status,
      createdAt: offer.created_at,
    }
  })

  return (
    <AppPageShell segments={["Tilbud"]}>
      <div className="flex w-full min-w-0 max-w-full flex-col gap-6 pb-8">
        <TilbudListClient rows={rows} />
      </div>
    </AppPageShell>
  )
}
