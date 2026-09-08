import { createClient } from "@/lib/supabase/server"

import type { IncomeAccountCategory } from "@/lib/tilbud/income-accounts"

/**
 * Fakturerbart arbeid på et prosjekt.
 *
 * En kilde er enten det aksepterte tilbudet eller en godkjent endringsordre
 * (tilleggsarbeid/etterfakturering). Hver kilde har en total, et beløp som allerede er
 * fakturert, og et gjenstående beløp. Det er gjenstående som kan velges inn på en ny
 * faktura — og det er dette regnestykket som gjør at samme arbeid ikke kan faktureres
 * to ganger, uansett om bedriften kjører sluttfaktura, a-konto eller separat tillegg.
 */
export type BillableSourceType = "offer" | "change_order"

export type BillableItem = {
  sourceType: BillableSourceType
  sourceId: string
  title: string
  description: string | null
  totalNok: number
  invoicedNok: number
  remainingNok: number
  /** Foreslått inntektskonto-kategori. Tilbud = blandet arbeid → tjeneste. */
  incomeAccountCategory: IncomeAccountCategory
}

function round(value: number) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100
}

/**
 * Hvor mye av hver kilde som allerede ligger på en faktura. Kansellerte fakturaer
 * teller ikke — de frigjør beløpet slik at det kan faktureres på nytt.
 */
async function fetchInvoicedBySource(
  companyId: string,
  projectId: string
): Promise<Map<string, number>> {
  const supabase = await createClient()

  const { data } = await supabase
    .from("project_invoice_lines")
    .select("source_type, source_id, amount_nok, project_invoices!inner(status, project_id)")
    .eq("company_id", companyId)
    .eq("project_invoices.project_id", projectId)
    .neq("project_invoices.status", "cancelled")

  const map = new Map<string, number>()
  for (const row of data ?? []) {
    const sourceId = (row as { source_id: string | null }).source_id
    const sourceType = (row as { source_type: string }).source_type
    if (!sourceId) continue
    const key = `${sourceType}:${sourceId}`
    map.set(key, round((map.get(key) ?? 0) + Number((row as { amount_nok: number }).amount_nok || 0)))
  }
  return map
}

export async function fetchProjectBillableItems(input: {
  companyId: string
  projectId: string
}): Promise<BillableItem[]> {
  const supabase = await createClient()

  const [offersResult, changeOrdersResult, invoicedMap] = await Promise.all([
    supabase
      .from("offers")
      .select("id, title, description, amount_nok, status")
      .eq("company_id", input.companyId)
      .eq("project_id", input.projectId)
      // Kun akseptert arbeid er fakturerbart. Et sendt tilbud er ikke en avtale ennå.
      .eq("status", "accepted"),
    supabase
      .from("change_orders")
      .select("id, title, description, amount_nok, status")
      .eq("company_id", input.companyId)
      .eq("project_id", input.projectId)
      .eq("status", "accepted"),
    fetchInvoicedBySource(input.companyId, input.projectId),
  ])

  const items: BillableItem[] = []

  for (const offer of offersResult.data ?? []) {
    const totalNok = round(Number(offer.amount_nok || 0))
    const invoicedNok = invoicedMap.get(`offer:${offer.id}`) ?? 0
    items.push({
      sourceType: "offer",
      sourceId: offer.id,
      title: offer.title || "Tilbud",
      description: offer.description ?? null,
      totalNok,
      invoicedNok,
      remainingNok: round(totalNok - invoicedNok),
      incomeAccountCategory: "tjeneste",
    })
  }

  for (const order of changeOrdersResult.data ?? []) {
    const totalNok = round(Number(order.amount_nok || 0))
    const invoicedNok = invoicedMap.get(`change_order:${order.id}`) ?? 0
    items.push({
      sourceType: "change_order",
      sourceId: order.id,
      title: order.title || "Tilleggsarbeid",
      description: order.description ?? null,
      totalNok,
      invoicedNok,
      remainingNok: round(totalNok - invoicedNok),
      incomeAccountCategory: "tjeneste",
    })
  }

  return items
}

/**
 * Valider et fakturautvalg mot det som faktisk gjenstår.
 *
 * Dette er vakten mot dobbeltfakturering, og den kjører på serveren — klienten viser
 * gjenstående, men kan ikke bestemme det. Litt slingringsmonn (1 øre) fordi beløpene
 * går gjennom avrunding flere steder.
 */
const OVERBILL_TOLERANCE_NOK = 0.01

export type InvoiceSelection = {
  sourceType: BillableSourceType
  sourceId: string
  amountNok: number
}

export function validateSelection(
  selection: InvoiceSelection[],
  billable: BillableItem[]
): { ok: true } | { ok: false; error: string } {
  if (selection.length === 0) {
    return { ok: false, error: "Velg minst én linje å fakturere." }
  }

  const byKey = new Map(billable.map((item) => [`${item.sourceType}:${item.sourceId}`, item]))
  const requestedByKey = new Map<string, number>()

  for (const entry of selection) {
    if (!Number.isFinite(entry.amountNok) || entry.amountNok <= 0) {
      return { ok: false, error: "Beløp må være større enn 0." }
    }
    const key = `${entry.sourceType}:${entry.sourceId}`
    if (!byKey.has(key)) {
      return { ok: false, error: "Én av linjene hører ikke til dette prosjektet." }
    }
    requestedByKey.set(key, round((requestedByKey.get(key) ?? 0) + entry.amountNok))
  }

  for (const [key, requested] of requestedByKey) {
    const item = byKey.get(key)!
    if (requested > item.remainingNok + OVERBILL_TOLERANCE_NOK) {
      return {
        ok: false,
        error: `«${item.title}» har bare ${item.remainingNok.toLocaleString("no-NO")} kr igjen å fakturere.`,
      }
    }
  }

  return { ok: true }
}
