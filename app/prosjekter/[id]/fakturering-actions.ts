"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"
import { canManageProjects } from "@/lib/roles"
import { logServerError } from "@/lib/errors/log"
import {
  fetchProjectBillableItems,
  validateSelection,
  type BillableItem,
  type InvoiceSelection,
} from "@/lib/fakturering/billable"
import {
  enqueueOfferFikenSyncAndProcess,
  enqueueProjectInvoiceFikenSync,
} from "@/lib/integrations/fiken/sync"

/** Hvilket regnskapssystem som faktisk kan ta imot fakturaen. */
export type AccountingProvider = "fiken" | "tripletex" | null

async function resolveAccountingProvider(
  supabase: Awaited<ReturnType<typeof createClient>>,
  companyId: string
): Promise<AccountingProvider> {
  const [fiken, tripletex] = await Promise.all([
    supabase.from("fiken_connections").select("sync_state").eq("company_id", companyId).maybeSingle(),
    supabase.from("tripletex_connections").select("sync_state").eq("company_id", companyId).maybeSingle(),
  ])
  if (fiken.data && fiken.data.sync_state !== "disconnected") return "fiken"
  if (tripletex.data && tripletex.data.sync_state !== "disconnected") return "tripletex"
  return null
}

export async function getAccountingProviderAction(projectId: string): Promise<AccountingProvider> {
  const { supabase, companyId } = await resolveContext(projectId)
  return resolveAccountingProvider(supabase, companyId)
}

export type ProjectInvoiceLine = {
  id: string
  source_type: "offer" | "change_order" | "manual"
  source_id: string | null
  description: string
  amount_nok: number
}

export type ProjectInvoice = {
  id: string
  reference: string | null
  status: "draft" | "queued" | "sent" | "paid" | "cancelled"
  amount_nok: number
  message: string | null
  due_days: number
  issued_at: string | null
  sent_at: string | null
  paid_at: string | null
  created_at: string
  project_invoice_lines: ProjectInvoiceLine[]
}

async function resolveContext(projectId: string) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error("Du må være logget inn")

  const { data: profile } = await supabase
    .from("users")
    .select("company_id, role")
    .eq("id", user.id)
    .maybeSingle()
  if (!profile?.company_id) throw new Error("Fant ikke bedrift")

  const { data: project } = await supabase
    .from("projects")
    .select("id, company_id, customer_id")
    .eq("id", projectId)
    .maybeSingle()
  if (!project || project.company_id !== profile.company_id) throw new Error("Ugyldig prosjekt")

  return {
    supabase,
    userId: user.id,
    companyId: profile.company_id as string,
    role: String(profile.role || ""),
    customerId: (project.customer_id as string | null) ?? null,
  }
}

export async function listProjectBillableItemsAction(projectId: string): Promise<BillableItem[]> {
  const { companyId } = await resolveContext(projectId)
  return fetchProjectBillableItems({ companyId, projectId })
}

export async function listProjectInvoicesAction(projectId: string): Promise<ProjectInvoice[]> {
  const { supabase, companyId } = await resolveContext(projectId)
  const { data } = await supabase
    .from("project_invoices")
    .select(
      "id, reference, status, amount_nok, message, due_days, issued_at, sent_at, paid_at, created_at, project_invoice_lines(id, source_type, source_id, description, amount_nok)"
    )
    .eq("company_id", companyId)
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
  return (data ?? []) as unknown as ProjectInvoice[]
}

/**
 * Opprett en faktura fra et utvalg fakturerbare linjer.
 *
 * Utvalget valideres mot GJENSTÅENDE beløp på serveren — klienten viser tallene, men
 * bestemmer dem ikke. Fakturaen sendes videre til Fiken, som eier fakturanummer og
 * utsending; her lager vi aldri et eget fakturanummer.
 */
export async function createProjectInvoiceAction(input: {
  projectId: string
  selection: InvoiceSelection[]
  message?: string
  dueDays?: number
}): Promise<
  { ok: true; invoiceId: string; queuedTo: AccountingProvider } | { ok: false; error: string }
> {
  const { supabase, companyId, userId, role, customerId } = await resolveContext(input.projectId)

  if (!canManageProjects(role)) {
    return { ok: false, error: "Du har ikke tilgang til å fakturere." }
  }

  const billable = await fetchProjectBillableItems({ companyId, projectId: input.projectId })
  const valid = validateSelection(input.selection, billable)
  if (!valid.ok) {
    return { ok: false, error: valid.error }
  }

  const byKey = new Map(billable.map((item) => [`${item.sourceType}:${item.sourceId}`, item]))
  const amountNok =
    Math.round(input.selection.reduce((sum, entry) => sum + entry.amountNok, 0) * 100) / 100

  const dueDays = Number.isFinite(input.dueDays) ? Math.min(365, Math.max(0, Number(input.dueDays))) : 14

  const { data: invoice, error: invoiceError } = await supabase
    .from("project_invoices")
    .insert({
      company_id: companyId,
      project_id: input.projectId,
      customer_id: customerId,
      status: "draft",
      amount_nok: amountNok,
      message: input.message?.trim() || null,
      due_days: dueDays,
      created_by: userId,
    })
    .select("id")
    .single()

  if (invoiceError || !invoice) {
    await logServerError({
      message: "Kunne ikke opprette prosjektfaktura",
      error: invoiceError,
      source: "server",
      route: "createProjectInvoiceAction",
      context: { projectId: input.projectId },
    })
    return { ok: false, error: invoiceError?.message || "Kunne ikke opprette faktura" }
  }

  const lines = input.selection.map((entry, index) => {
    const item = byKey.get(`${entry.sourceType}:${entry.sourceId}`)!
    const amount = Math.round(entry.amountNok * 100) / 100
    // Delfakturering (a-konto) merkes i beskrivelsen, slik at kunden ser at dette er
    // en andel og ikke hele posten.
    const isPartial = amount < item.remainingNok - 0.01 || item.invoicedNok > 0
    return {
      company_id: companyId,
      invoice_id: invoice.id,
      source_type: entry.sourceType,
      source_id: entry.sourceId,
      description: isPartial ? `${item.title} (delfakturering)` : item.title,
      quantity: 1,
      unit: "stk",
      unit_price_nok: amount,
      income_account_category: item.incomeAccountCategory,
      amount_nok: amount,
      sort_order: index,
    }
  })

  const { error: linesError } = await supabase.from("project_invoice_lines").insert(lines)
  if (linesError) {
    // Ryd opp: en fakturahode uten linjer ville låst beløp uten å representere noe.
    await supabase.from("project_invoices").delete().eq("id", invoice.id)
    return { ok: false, error: linesError.message }
  }

  // Fakturaen er registrert i ProAnbud uansett — den holder dobbeltfaktura-regnskapet
  // riktig og teller i lønnsomhet. Men vi må si SANT om den faktisk er sendt videre:
  // de fleste bedrifter har ingen regnskapsintegrasjon, og da skjer det ingenting mer.
  const queued = await enqueueProjectInvoiceFikenSync({
    companyId,
    projectInvoiceId: invoice.id,
    projectId: input.projectId,
    customerId,
  })

  revalidatePath(`/prosjekter/${input.projectId}`)
  return { ok: true, invoiceId: invoice.id, queuedTo: queued ? "fiken" : null }
}

/** Kansellering frigjør beløpet, slik at arbeidet kan faktureres på nytt. */
export async function cancelProjectInvoiceAction(input: {
  projectId: string
  invoiceId: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { supabase, companyId, role } = await resolveContext(input.projectId)
  if (!canManageProjects(role)) {
    return { ok: false, error: "Du har ikke tilgang til å endre fakturaer." }
  }

  const { data: existing } = await supabase
    .from("project_invoices")
    .select("status")
    .eq("id", input.invoiceId)
    .eq("company_id", companyId)
    .maybeSingle()

  if (!existing) return { ok: false, error: "Fant ikke fakturaen." }
  if (existing.status === "sent" || existing.status === "paid") {
    return {
      ok: false,
      error: "Fakturaen er allerede sendt fra Fiken. Krediter den i Fiken i stedet.",
    }
  }

  const { error } = await supabase
    .from("project_invoices")
    .update({ status: "cancelled" })
    .eq("id", input.invoiceId)
    .eq("company_id", companyId)

  if (error) return { ok: false, error: error.message }

  revalidatePath(`/prosjekter/${input.projectId}`)
  return { ok: true }
}

/**
 * «Fakturer jobben» fra selve tilbudet.
 *
 * Dette er en SNARVEI inn i den samme modellen — ikke en egen fakturavei. Den bygger
 * nøyaktig samme `project_invoices`-rad som Fakturering-fanen gjør, med samme validering
 * mot gjenstående. To innganger, én mekanisme: ellers ville de to kunne fakturere samme
 * arbeid hver for seg.
 *
 * Tar med tilbudet og tilleggsarbeid som hører til DETTE tilbudet
 * (change_orders.offer_id = tilbudet). Etterfakturering opprettet direkte på prosjektet
 * hører til prosjektet, ikke tilbudet, og må faktureres derfra.
 */
export async function invoiceOfferAction(input: {
  offerId: string
}): Promise<
  { ok: true; amountNok: number; lines: number; queuedTo: AccountingProvider } | { ok: false; error: string }
> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "Du må være logget inn" }

  const { data: profile } = await supabase
    .from("users")
    .select("company_id, role")
    .eq("id", user.id)
    .maybeSingle()
  if (!profile?.company_id) return { ok: false, error: "Fant ikke bedrift" }
  if (!canManageProjects(String(profile.role || ""))) {
    return { ok: false, error: "Du har ikke tilgang til å fakturere." }
  }

  const companyId = profile.company_id as string
  const { data: offer } = await supabase
    .from("offers")
    .select("id, project_id, customer_id, status, title")
    .eq("id", input.offerId)
    .eq("company_id", companyId)
    .maybeSingle()

  if (!offer) return { ok: false, error: "Fant ikke tilbudet." }
  if (offer.status !== "accepted") {
    return { ok: false, error: "Tilbudet må være akseptert før det kan faktureres." }
  }

  // Tilbud uten prosjekt kan ikke bli en prosjektfaktura (project_id er påkrevd).
  // Da brukes den gamle veien: hele tilbudet faktureres i ett.
  if (!offer.project_id) {
    const enqueued = await enqueueOfferFikenSyncAndProcess({
      companyId,
      offerId: offer.id,
      customerId: String(offer.customer_id || ""),
      projectId: null,
      source: "offer-invoice-button",
      phase: "order",
      sendToCustomer: true,
    })
    if (!enqueued) {
      return {
        ok: false,
        error:
          "Tilbudet har ikke prosjekt, og Fiken er ikke tilkoblet. Legg tilbudet på et prosjekt, eller fakturer i regnskapssystemet ditt.",
      }
    }
    return { ok: true, amountNok: 0, lines: 1, queuedTo: "fiken" }
  }

  const projectId = String(offer.project_id)
  const billable = await fetchProjectBillableItems({ companyId, projectId })

  // Endringsordrene som hører til dette tilbudet.
  const { data: ownChangeOrders } = await supabase
    .from("change_orders")
    .select("id")
    .eq("company_id", companyId)
    .eq("offer_id", offer.id)
    .eq("status", "accepted")
  const ownChangeOrderIds = new Set((ownChangeOrders ?? []).map((row) => String(row.id)))

  const selection: InvoiceSelection[] = billable
    .filter(
      (item) =>
        item.remainingNok > 0.009 &&
        ((item.sourceType === "offer" && item.sourceId === offer.id) ||
          (item.sourceType === "change_order" && ownChangeOrderIds.has(item.sourceId)))
    )
    .map((item) => ({
      sourceType: item.sourceType,
      sourceId: item.sourceId,
      amountNok: item.remainingNok,
    }))

  if (selection.length === 0) {
    return { ok: false, error: "Alt på dette tilbudet er allerede fakturert." }
  }

  const created = await createProjectInvoiceAction({ projectId, selection })
  if (!created.ok) return created

  return {
    ok: true,
    amountNok: Math.round(selection.reduce((sum, entry) => sum + entry.amountNok, 0) * 100) / 100,
    lines: selection.length,
    queuedTo: created.queuedTo,
  }
}
