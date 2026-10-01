/**
 * Materialkostnader ført i ProAnbud → regnskapet, som KLADD.
 *
 * Ren logikk, ingen server-avhengigheter (testbar). Workerne i
 * lib/integrations/{fiken,tripletex}/cost-push.ts gjør selve kallene.
 *
 * Hvorfor kladd og ikke ferdig bokført: leverandørfakturaen kommer som regel inn i
 * regnskapet uansett (EHF, innboks). Et ferdig bokført kjøp fra ProAnbud ville da
 * stått der to ganger. Kladden er et forslag regnskapsføreren fullfører eller
 * forkaster; når kjøpet bokføres, kommer det tilbake med kostnadshentingen og
 * kobles til den manuelle posten (matchManualToBooked), så det telles én gang.
 *
 * Forslagene (konto 4300 «Innkjøp av varer for videresalg», 25 % inngående mva)
 * er bare utgangspunkt — de rettes i kladden.
 */

export const DEFAULT_COST_ACCOUNT = "4300"
/** Leverandørgjeld — motkonto i Tripletex-bilaget. */
export const SUPPLIER_DEBT_ACCOUNT = "2400"
const HIGH_VAT_RATE = 0.25

export type ManualCostForPush = {
  id: string
  supplierName: string | null
  description: string | null
  amountNok: number
  invoiceRef: string | null
  costDate: string | null
  projectName: string | null
}

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

/** Merket som gjør at vi kjenner igjen vår egen kladd (søk før opprettelse). */
export function proanbudCostMarker(costId: string) {
  return `ProAnbud #${costId.slice(0, 8)}`
}

/** «Optimera – Fliser og lim · Bad Hansen (ProAnbud #1a2b3c4d)», maks `max` tegn. */
export function costDraftText(cost: ManualCostForPush, max = 200) {
  const what = [cost.supplierName, cost.description].filter(Boolean).join(" – ") || "Materialkost"
  const suffix = ` (${proanbudCostMarker(cost.id)})`
  const project = cost.projectName ? ` · ${cost.projectName}` : ""
  const body = `${what}${project}`
  const room = max - suffix.length
  return `${body.length > room ? `${body.slice(0, Math.max(0, room - 1))}…` : body}${suffix}`
}

export function grossAmount(netNok: number, vatRegistered: boolean) {
  return round2(vatRegistered ? netNok * (1 + HIGH_VAT_RATE) : netNok)
}

/** Fiken: POST /purchases/drafts. Beløp i øre; `incomeAccount` er kostnadskontoen på kjøp. */
export function buildFikenPurchaseDraft(
  cost: ManualCostForPush,
  input: { fikenProjectId: number | null; vatRegistered: boolean; today: string }
) {
  const net = Math.round(cost.amountNok * 100)
  const gross = Math.round(grossAmount(cost.amountNok, input.vatRegistered) * 100)
  const line: Record<string, unknown> = {
    text: costDraftText(cost),
    vatType: input.vatRegistered ? "HIGH" : "NONE",
    incomeAccount: DEFAULT_COST_ACCOUNT,
    net,
    gross,
  }
  if (input.fikenProjectId !== null) line.projectId = input.fikenProjectId

  const draft: Record<string, unknown> = {
    invoiceIssueDate: cost.costDate ?? input.today,
    cash: false,
    paid: false,
    currency: "NOK",
    lines: [line],
  }
  if (cost.invoiceRef) draft.invoiceNumber = cost.invoiceRef.slice(0, 100)
  if (input.fikenProjectId !== null) draft.projectId = input.fikenProjectId
  return draft
}

/**
 * Tripletex: POST /ledger/voucher?sendToLedger=false — et bilag som ikke er
 * bokført. Debet kostnadskonto (med prosjekt og inngående mva), kredit
 * leverandørgjeld. Tripletex bruker bare bruttobeløpene og regner ut mva selv.
 */
export function buildTripletexCostVoucher(
  cost: ManualCostForPush,
  input: {
    costAccountId: number
    supplierDebtAccountId: number
    vatTypeId: number | null
    projectExternalId: number | null
    supplierId: number | null
    vatRegistered: boolean
    today: string
  }
) {
  const date = cost.costDate ?? input.today
  const gross = grossAmount(cost.amountNok, input.vatRegistered)
  const text = costDraftText(cost, 255)

  const debit: Record<string, unknown> = {
    row: 1,
    date,
    description: text,
    account: { id: input.costAccountId },
    amountGross: gross,
    amountGrossCurrency: gross,
  }
  if (input.vatTypeId !== null) debit.vatType = { id: input.vatTypeId }
  if (input.projectExternalId !== null) debit.project = { id: input.projectExternalId }

  const credit: Record<string, unknown> = {
    row: 2,
    date,
    description: text,
    account: { id: input.supplierDebtAccountId },
    amountGross: -gross,
    amountGrossCurrency: -gross,
  }
  if (input.supplierId !== null) credit.supplier = { id: input.supplierId }

  const voucher: Record<string, unknown> = {
    date,
    description: text,
    externalVoucherNumber: proanbudCostMarker(cost.id).replace(/\s+/g, "-"),
    postings: [debit, credit],
  }
  if (cost.invoiceRef) voucher.vendorInvoiceNumber = cost.invoiceRef.slice(0, 100)
  return voucher
}
