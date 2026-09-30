/**
 * Kostnader inn fra regnskapet — ren logikk, ingen server-avhengigheter.
 *
 * Hva som telles som prosjektkostnad, og hva som bevisst holdes utenfor:
 *
 * - Konto 4000–7999 (varekost, fremmedytelser og andre driftskostnader) teller.
 * - Konto 5000–5999 (lønn) teller ALDRI. Lønnskosten regnes alltid i ProAnbud som
 *   førte timer × kostpris; henter vi lønnsposteringene også, telles den to ganger.
 * - 8000+ er finans og skatt, ikke prosjektkostnad.
 * - Reiseregninger ProAnbud selv har sendt fra kjøreboka holdes utenfor. Kjøreboka
 *   teller dem allerede som kjøregodtgjørelse.
 */

export type AccountingCostRow = {
  projectId: string
  externalId: string
  costDate: string | null
  accountNumber: string | null
  accountName: string | null
  supplierName: string | null
  description: string | null
  voucherRef: string | null
  amountNok: number
}

function round(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

/** «4300», «4300 Innkjøp», «1920:10001» → første tallrekke. */
export function parseAccountNumber(value: unknown): number | null {
  const match = String(value ?? "").match(/^\s*(\d{4})/)
  return match ? Number(match[1]) : null
}

export function isProjectCostAccount(accountNumber: number | null): boolean {
  if (accountNumber === null) return false
  if (accountNumber < 4000 || accountNumber > 7999) return false
  return accountNumber < 5000 || accountNumber > 5999
}

function text(value: unknown): string | null {
  const trimmed = typeof value === "string" ? value.trim() : ""
  return trimmed ? trimmed : null
}

// --- Tripletex -----------------------------------------------------------------

type TripletexPosting = {
  id?: unknown
  date?: unknown
  description?: unknown
  amount?: unknown
  account?: { number?: unknown; name?: unknown } | null
  supplier?: { name?: unknown } | null
  voucher?: { id?: unknown; number?: unknown; year?: unknown } | null
}

/**
 * Posteringer på ett prosjekt → kostnadsrader. Beløpet er posteringens beløp på
 * kostnadskontoen — mva ligger på egen konto og er dermed allerede trukket ut.
 * Kreditposteringer (negative) beholdes: en kreditnota skal trekke fra.
 */
export function mapTripletexPostingsToCosts(
  postings: TripletexPosting[],
  input: { projectId: string; excludedVoucherIds?: Set<number> }
): AccountingCostRow[] {
  const rows: AccountingCostRow[] = []
  for (const posting of postings) {
    const id = Number(posting.id)
    const amount = Number(posting.amount)
    if (!Number.isFinite(id) || !Number.isFinite(amount) || amount === 0) continue

    const accountNumber = parseAccountNumber(posting.account?.number)
    if (!isProjectCostAccount(accountNumber)) continue

    const voucherId = Number(posting.voucher?.id)
    if (Number.isFinite(voucherId) && input.excludedVoucherIds?.has(voucherId)) continue

    const voucherNumber = posting.voucher?.number
    const voucherYear = posting.voucher?.year
    rows.push({
      projectId: input.projectId,
      externalId: String(id),
      costDate: text(posting.date)?.slice(0, 10) ?? null,
      accountNumber: accountNumber === null ? null : String(accountNumber),
      accountName: text(posting.account?.name),
      supplierName: text(posting.supplier?.name),
      description: text(posting.description),
      voucherRef:
        voucherNumber !== undefined && voucherNumber !== null
          ? voucherYear
            ? `${voucherNumber}-${voucherYear}`
            : String(voucherNumber)
          : null,
      amountNok: round(amount),
    })
  }
  return rows
}

// --- Fiken ---------------------------------------------------------------------

type FikenPurchaseLine = {
  lineId?: unknown
  description?: unknown
  netPrice?: unknown
  account?: unknown
  projectId?: unknown
}

type FikenPurchase = {
  purchaseId?: unknown
  identifier?: unknown
  date?: unknown
  deleted?: unknown
  supplier?: { name?: unknown } | null
  project?: Array<{ projectId?: unknown }> | null
  lines?: FikenPurchaseLine[] | null
}

/**
 * Innkjøp → kostnadsrader for de prosjektene som er koblet. Fiken fører prosjekt
 * per LINJE; står det bare på kjøpet (ett prosjekt), gjelder det alle linjene.
 * Beløp er i øre i Fikens API og `netPrice` er eks. mva.
 */
export function mapFikenPurchasesToCosts(
  purchases: FikenPurchase[],
  projectByFikenId: Map<number, string>
): AccountingCostRow[] {
  const rows: AccountingCostRow[] = []
  for (const purchase of purchases) {
    if (purchase.deleted === true) continue
    const purchaseId = Number(purchase.purchaseId)
    if (!Number.isFinite(purchaseId)) continue

    const purchaseProjects = (purchase.project ?? [])
      .map((p) => Number(p?.projectId))
      .filter((id) => Number.isFinite(id))
    const fallbackProject = purchaseProjects.length === 1 ? purchaseProjects[0] : null

    ;(purchase.lines ?? []).forEach((line, index) => {
      const lineProject = Number(line.projectId)
      const fikenProjectId = Number.isFinite(lineProject) ? lineProject : fallbackProject
      if (fikenProjectId === null) return
      const projectId = projectByFikenId.get(fikenProjectId)
      if (!projectId) return

      const accountNumber = parseAccountNumber(line.account)
      if (!isProjectCostAccount(accountNumber)) return

      const amount = Number(line.netPrice) / 100
      if (!Number.isFinite(amount) || amount === 0) return

      const lineId = Number(line.lineId)
      rows.push({
        projectId,
        externalId: `${purchaseId}:${Number.isFinite(lineId) ? lineId : `i${index}`}`,
        costDate: text(purchase.date)?.slice(0, 10) ?? null,
        accountNumber: accountNumber === null ? null : String(accountNumber),
        accountName: null,
        supplierName: text(purchase.supplier?.name),
        description: text(line.description),
        voucherRef: text(purchase.identifier),
        amountNok: round(amount),
      })
    })
  }
  return rows
}

// --- Regelen for dobbelttelling --------------------------------------------------

/**
 * Hvilken materialkost prosjektet skal regnes med.
 *
 * Har regnskapet kostnader på prosjektet, er det fasiten — og de manuelle
 * materialpostene telles ikke, fordi samme faktura ellers står to steder. Er
 * prosjektet hentet uten at noe er ført der, gjelder de manuelle postene som før.
 */
export function resolveMaterialCostSource(input: {
  manualNok: number
  accountingRows: Array<{ amount_nok: number | string }>
}): { materialCostNok: number; source: "regnskap" | "manuell"; manualExcludedNok: number } {
  if (input.accountingRows.length === 0) {
    return { materialCostNok: round(input.manualNok), source: "manuell", manualExcludedNok: 0 }
  }
  const accountingNok = input.accountingRows.reduce((sum, row) => sum + Number(row.amount_nok || 0), 0)
  return {
    materialCostNok: round(accountingNok),
    source: "regnskap",
    manualExcludedNok: round(input.manualNok),
  }
}
