import { calculateLineItemUnitPriceWithMarkupBeforeDiscount, type OfferLineItem } from "@/lib/tilbud/types"
import {
  effectiveIncomeAccountCategory,
  normalizeIncomeAccountCategory,
  resolveIncomeAccountCode,
} from "@/lib/tilbud/income-accounts"
import type {
  FikenContactPayload,
  FikenDraftLinePayload,
  FikenProjectPayload,
  FikenVatType,
} from "@/lib/integrations/fiken/types"

export type FikenCustomerSource = {
  name: string
  email: string | null
  phone: string | null
  org_number: string | null
  address: string | null
  postal_code: string | null
  city: string | null
}

export function mapCustomerToFiken(customer: FikenCustomerSource): FikenContactPayload {
  const payload: FikenContactPayload = {
    name: customer.name,
    customer: true,
    email: customer.email || undefined,
    organizationNumber: customer.org_number || undefined,
    phoneNumber: customer.phone || undefined,
  }

  // Fiken requires ALL of streetAddress/city/postCode/country when an address is sent.
  // Only include the address object if we have enough to satisfy that.
  if (customer.address && customer.postal_code && customer.city) {
    payload.address = {
      streetAddress: customer.address,
      postCode: customer.postal_code,
      city: customer.city,
      country: "Norway",
    }
  }

  return payload
}

function dateOnly(value: string | null | undefined): string | undefined {
  if (!value) return undefined
  const s = String(value)
  return s.length >= 10 ? s.slice(0, 10) : s
}

export function resolveFikenProjectStartDate(project: {
  start_date?: string | null
  created_at?: string | null
}): string {
  return dateOnly(project.start_date) || dateOnly(project.created_at) || new Date().toISOString().slice(0, 10)
}

export function mapProjectToFiken(
  project: {
    name: string
    status: string | null
    description: string | null
    start_date?: string | null
    end_date?: string | null
    created_at?: string | null
  },
  options: { number: string; contactId?: number; startDate: string }
): FikenProjectPayload {
  return {
    name: project.name,
    number: options.number,
    startDate: options.startDate,
    endDate: dateOnly(project.end_date),
    contactId: options.contactId,
    description: project.description || undefined,
    completed: project.status === "completed",
  }
}

// --- Lines ------------------------------------------------------------------
function normalizeOfferLineItems(input: unknown): OfferLineItem[] {
  if (!Array.isArray(input)) {
    return []
  }

  return input
    .map((row) => {
      const item = row as Partial<OfferLineItem>
      return {
        id: String(item.id || crypto.randomUUID()),
        subproject: String(item.subproject || "Generelt"),
        title: String(item.title || ""),
        description: String(item.description || ""),
        quantity: Number(item.quantity || 0),
        unit: String(item.unit || "stk"),
        supplier: String(item.supplier || ""),
        nobb: item.nobb ? String(item.nobb) : undefined,
        supplierSku: item.supplierSku ? String(item.supplierSku) : undefined,
        supplierUrl: item.supplierUrl ? String(item.supplierUrl) : undefined,
        unitPriceNok: Number(item.unitPriceNok || 0),
        markupPercent: Number(item.markupPercent || 0),
        discountPercent: Number(item.discountPercent || 0),
        // MÅ tas med: denne normaliseringen bygger objektet på nytt, så et felt som
        // ikke nevnes her forsvinner stille — og da ville per-linje-kontoen aldri nå Fiken.
        incomeAccountCategory: normalizeIncomeAccountCategory(item.incomeAccountCategory),
      } satisfies OfferLineItem
    })
    .filter((item) => item.title.trim().length > 0 && item.quantity > 0)
}

/**
 * Convert an ex-VAT unit price (NOK) to Fiken's øre integer.
 *
 * Verified against the live Fiken OpenAPI spec (invoiceishDraftLine.unitPrice):
 * "Net price per unit in invoice currency (in cents)". So unitPrice is the NET
 * (ex-VAT) price in øre — Fiken derives VAT from vatType. The discount is sent
 * separately as a percentage so it is never applied twice (markup-before-discount).
 */
export function toFikenNetUnitPriceOre(exVatNok: number): number {
  return Math.round(exVatNok * 100)
}

/** Fikens invoiceishDraftLine.description har maxLength 200 — lengre gir HTTP 400. */
const FIKEN_LINE_DESCRIPTION_MAX = 200

function truncateForFiken(value: string): string {
  if (value.length <= FIKEN_LINE_DESCRIPTION_MAX) return value
  return `${value.slice(0, FIKEN_LINE_DESCRIPTION_MAX - 1).trimEnd()}…`
}

function lineDescription(item: OfferLineItem): string {
  const parts = [item.title.trim()]
  if (item.description.trim()) {
    parts.push(item.description.trim())
  }
  if (item.subproject && item.subproject !== "Generelt") {
    parts.unshift(`[${item.subproject}]`)
  }
  return truncateForFiken(parts.join(" – "))
}

export function buildFikenDraftLines(
  offer: {
    id: string
    title: string | null
    description: string | null
    amount_nok: number | null
    line_items?: unknown
  },
  options: { vatType: FikenVatType; vatRegistered: boolean; incomeAccount?: string | null }
): FikenDraftLinePayload[] {
  const items = normalizeOfferLineItems(offer.line_items)
  // Fiken rejects ANY free-text line without an incomeAccount (HTTP 400). Every line we
  // build is free-text, so this must never be undefined.
  //
  // Precedence: an explicit connection-level override wins (one account for everything),
  // otherwise each line resolves its own account from its category — which is what Fiken's
  // own tilbud dialog asks for, and what keeps varesalg and tjenestesalg on separate
  // accounts in the ledger instead of collapsing into one.
  const overrideAccount = options.incomeAccount?.trim()
  // vatRegistered kommer ALLTID inn eksplisitt. Å utlede den fra vatType (f.eks.
  // `!== "NONE"`) er feil: en ikke-registrert bedrift sender OUTSIDE, som da ville
  // blitt lest som «registrert» og gitt 30xx-konti i stedet for 32xx.
  const vatRegistered = options.vatRegistered
  const accountFor = (item: (typeof items)[number]) =>
    overrideAccount || resolveIncomeAccountCode(effectiveIncomeAccountCategory(item), vatRegistered)

  if (items.length > 0) {
    return items.map((item) => {
      const exVatUnit = calculateLineItemUnitPriceWithMarkupBeforeDiscount(item)
      const line: FikenDraftLinePayload = {
        description: lineDescription(item),
        unitPrice: toFikenNetUnitPriceOre(exVatUnit),
        quantity: item.quantity,
        vatType: options.vatType,
      }
      if (item.discountPercent > 0) {
        line.discount = item.discountPercent
      }
      line.incomeAccount = accountFor(item)
      return line
    })
  }

  // Fallback: a single summary line from the offer total.
  const line: FikenDraftLinePayload = {
    description: offer.title || offer.description || `Tilbud ${offer.id.slice(0, 8)}`,
    unitPrice: toFikenNetUnitPriceOre(Number(offer.amount_nok || 0)),
    quantity: 1,
    vatType: options.vatType,
  }
  // Samlelinja har ingen vare/tjeneste-identitet å gjette fra, så den bruker
  // standardkategorien — men fortsatt mva-riktig konto (3020 vs 3220).
  line.incomeAccount = overrideAccount || resolveIncomeAccountCode(undefined, vatRegistered)
  return [line]
}

/**
 * Body for POST /offers/drafts (invoiceishDraftRequest).
 * Spec requires `type`, `customerId` and `daysUntilDueDate` even for offers.
 */
export function mapOfferDraftFromOffer(
  offer: {
    id: string
    title: string | null
    description: string | null
    amount_nok: number | null
    line_items?: unknown
  },
  customerId: number,
  options: {
    projectId?: number | null
    vatType: FikenVatType
    vatRegistered: boolean
    incomeAccount?: string | null
    daysUntilDueDate?: number
  }
): Record<string, unknown> {
  return {
    type: "offer",
    customerId,
    daysUntilDueDate: options.daysUntilDueDate ?? 14,
    ...(options.projectId ? { projectId: options.projectId } : {}),
    lines: buildFikenDraftLines(offer, options),
  }
}

/**
 * Body for POST /invoices/drafts (invoiceishDraftRequest).
 *
 * ⚠️ BANKKONTO: tre felt heter nesten det samme, og bare ETT virker her.
 *   `bankAccountCode`  → finnes ikke i draft-skjemaet (kun invoiceRequest). Ignorert
 *                        stille → konto ble null.
 *   `paymentAccount`   → «Draft of type INVOICE cannot have a payment account
 *                        specified. A payment account is only allowed for drafts of
 *                        type CASH_INVOICE.»
 *   `bankAccountNumber`→ ✅ RIKTIG. Selve kontonummeret, f.eks. «15035646830».
 * Uten det svarer Fiken 403: «The bank account number null has not been verified as
 * belonging to this company.» Kontoen må i tillegg være Altinn-bekreftet i Fiken.
 */
export function mapInvoiceDraftFromOffer(
  offer: {
    id: string
    title: string | null
    description: string | null
    amount_nok: number | null
    line_items?: unknown
  },
  customerId: number,
  options: {
    projectId?: number | null
    vatType: FikenVatType
    vatRegistered: boolean
    incomeAccount?: string | null
    daysUntilDueDate?: number
    /** Kontonummeret pengene skal til, f.eks. «15035646830». */
    bankAccountNumber?: string | null
  }
): Record<string, unknown> {
  const issueDate = new Date().toISOString().slice(0, 10)
  return {
    type: "invoice",
    customerId,
    issueDate,
    daysUntilDueDate: options.daysUntilDueDate ?? 14,
    ...(options.projectId ? { projectId: options.projectId } : {}),
    ...(options.bankAccountNumber ? { bankAccountNumber: options.bankAccountNumber } : {}),
    lines: buildFikenDraftLines(offer, options),
  }
}

/**
 * Faktura bygget fra et prosjektfaktura-utvalg (project_invoice_lines) i stedet for fra
 * et helt tilbud. Hver linje bærer sin egen inntektskonto-kategori, så a-konto,
 * sluttfaktura og separat tilleggsfaktura alle havner på riktige konti i regnskapet.
 */
export function mapInvoiceDraftFromProjectInvoice(
  lines: Array<{
    description: string
    quantity: number | null
    unit_price_nok: number | null
    income_account_category?: string | null
  }>,
  customerId: number,
  options: {
    projectId?: number | null
    vatType: FikenVatType
    vatRegistered: boolean
    incomeAccount?: string | null
    daysUntilDueDate?: number
    /**
     * Vår egen UUID for utkastet. Fiken lagrer den, og `GET /invoices?invoiceDraftUuid=`
     * lar oss senere finne fakturaen som ble laget av nettopp dette utkastet. Det er
     * det som gjør en tvetydig ferdigstilling gjenopprettbar i stedet for farlig.
     */
    draftUuid?: string | null
    /** Melding til kunden — skrives over fakturalinjene. */
    invoiceText?: string | null
    /** Vår referanse, så fakturaen kan spores tilbake til prosjektet. */
    ourReference?: string | null
    /** Kontonummeret pengene skal til, f.eks. «15035646830». Se doc over. */
    bankAccountNumber?: string | null
  }
): Record<string, unknown> {
  const overrideAccount = options.incomeAccount?.trim()
  // Samme regel som for tilbudslinjene: mva-status er et faktum om bedriften og
  // sendes inn eksplisitt — den kan ikke leses ut av vatType.
  const vatRegistered = options.vatRegistered

  return {
    type: "invoice",
    customerId,
    issueDate: new Date().toISOString().slice(0, 10),
    daysUntilDueDate: options.daysUntilDueDate ?? 14,
    ...(options.projectId ? { projectId: options.projectId } : {}),
    ...(options.bankAccountNumber ? { bankAccountNumber: options.bankAccountNumber } : {}),
    ...(options.draftUuid ? { uuid: options.draftUuid } : {}),
    ...(options.invoiceText?.trim() ? { invoiceText: options.invoiceText.trim() } : {}),
    ...(options.ourReference?.trim() ? { ourReference: options.ourReference.trim() } : {}),
    lines: lines.map((line) => ({
      description: truncateForFiken(line.description),
      unitPrice: toFikenNetUnitPriceOre(Number(line.unit_price_nok || 0)),
      quantity: Number(line.quantity || 1),
      vatType: options.vatType,
      incomeAccount:
        overrideAccount ||
        resolveIncomeAccountCode(
          normalizeIncomeAccountCategory(line.income_account_category),
          vatRegistered
        ),
    })),
  }
}
