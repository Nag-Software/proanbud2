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

// --- Inntekter ----------------------------------------------------------------------

/** Inntekt bokført på et prosjekt (konto 3000–3999), eks. mva. */
export type AccountingRevenueRow = {
  projectId: string
  externalId: string
  entryDate: string | null
  accountNumber: string | null
  accountName: string | null
  customerName: string | null
  description: string | null
  voucherRef: string | null
  amountNok: number
}

export function isProjectRevenueAccount(accountNumber: number | null): boolean {
  return accountNumber !== null && accountNumber >= 3000 && accountNumber <= 3999
}

type TripletexRevenuePosting = TripletexPosting & {
  customer?: { name?: unknown } | null
  invoiceNumber?: unknown
}

/**
 * Inntektsposteringer på ett prosjekt → inntektsrader. Salgsinntekt står på kredit
 * (negativt beløp) i hovedboka; vi snur fortegnet, så en faktura er positiv og en
 * kreditnota negativ.
 */
export function mapTripletexPostingsToRevenues(
  postings: TripletexRevenuePosting[],
  input: { projectId: string }
): AccountingRevenueRow[] {
  const rows: AccountingRevenueRow[] = []
  for (const posting of postings) {
    const id = Number(posting.id)
    const amount = Number(posting.amount)
    if (!Number.isFinite(id) || !Number.isFinite(amount) || amount === 0) continue
    const accountNumber = parseAccountNumber(posting.account?.number)
    if (!isProjectRevenueAccount(accountNumber)) continue

    const invoiceNumber = text(typeof posting.invoiceNumber === "number" ? String(posting.invoiceNumber) : posting.invoiceNumber)
    const voucherNumber = posting.voucher?.number
    rows.push({
      projectId: input.projectId,
      externalId: String(id),
      entryDate: text(posting.date)?.slice(0, 10) ?? null,
      accountNumber: accountNumber === null ? null : String(accountNumber),
      accountName: text(posting.account?.name),
      customerName: text(posting.customer?.name),
      description: text(posting.description),
      voucherRef:
        invoiceNumber ??
        (voucherNumber !== undefined && voucherNumber !== null ? String(voucherNumber) : null),
      amountNok: round(-amount),
    })
  }
  return rows
}

type FikenSale = {
  saleId?: unknown
  saleNumber?: unknown
  date?: unknown
  deleted?: unknown
  customer?: { name?: unknown } | null
  project?: { projectId?: unknown } | Array<{ projectId?: unknown }> | null
  lines?: FikenPurchaseLine[] | null
}

/**
 * Salg (fakturaer, kontantsalg, eksterne fakturaer) → inntektsrader for koblede
 * prosjekter. Bare /sales — fakturaene i /invoices er de samme salgene, og å lese
 * begge ville telt hver faktura to ganger. Beløp i øre, `netPrice` eks. mva.
 */
export function mapFikenSalesToRevenues(
  sales: FikenSale[],
  projectByFikenId: Map<number, string>
): AccountingRevenueRow[] {
  const rows: AccountingRevenueRow[] = []
  for (const sale of sales) {
    if (sale.deleted === true) continue
    const saleId = Number(sale.saleId)
    if (!Number.isFinite(saleId)) continue

    const saleProjects = (Array.isArray(sale.project) ? sale.project : sale.project ? [sale.project] : [])
      .map((p) => Number(p?.projectId))
      .filter((id) => Number.isFinite(id))
    const fallbackProject = saleProjects.length === 1 ? saleProjects[0] : null

    ;(sale.lines ?? []).forEach((line, index) => {
      const lineProject = Number(line.projectId)
      const fikenProjectId = Number.isFinite(lineProject) ? lineProject : fallbackProject
      if (fikenProjectId === null) return
      const projectId = projectByFikenId.get(fikenProjectId)
      if (!projectId) return

      const accountNumber = parseAccountNumber(line.account)
      if (!isProjectRevenueAccount(accountNumber)) return

      const amount = Number(line.netPrice) / 100
      if (!Number.isFinite(amount) || amount === 0) return

      const lineId = Number(line.lineId)
      rows.push({
        projectId,
        externalId: `${saleId}:${Number.isFinite(lineId) ? lineId : `i${index}`}`,
        entryDate: text(sale.date)?.slice(0, 10) ?? null,
        accountNumber: accountNumber === null ? null : String(accountNumber),
        accountName: null,
        customerName: text(sale.customer?.name),
        description: text(line.description),
        voucherRef: sale.saleNumber !== undefined && sale.saleNumber !== null ? String(sale.saleNumber) : null,
        amountNok: round(amount),
      })
    })
  }
  return rows
}

// --- Regelen for dobbelttelling --------------------------------------------------

/** Én rad i project_material_costs, slik matchingen og summeringen trenger den. */
export type MaterialCostLike = {
  id: string
  source: "manual" | "fiken" | "tripletex"
  amount_nok: number | string
  cost_date: string | null
  voucher_ref?: string | null
  replaced_by?: string | null
  keep_separate?: boolean | null
}

/** Så langt fra hverandre kan en manuell post og bilaget for samme kjøp ligge i tid. */
const MATCH_WINDOW_DAYS = 45

function daysApart(a: string | null, b: string | null) {
  if (!a || !b) return 0
  const diff = Math.abs(new Date(`${a.slice(0, 10)}T12:00:00Z`).getTime() - new Date(`${b.slice(0, 10)}T12:00:00Z`).getTime())
  return Number.isFinite(diff) ? diff / 86_400_000 : Number.POSITIVE_INFINITY
}

/** Beløpene er «like» innenfor 1 kr eller 0,5 % — avrunding på fakturaen. */
function sameAmount(a: number, b: number) {
  return Math.abs(a - b) <= Math.max(1, Math.abs(b) * 0.005)
}

/**
 * Finner manuelle poster som nå er bokført i regnskapet, så samme kjøp telles én gang.
 *
 * En manuell post kobles til en bokført kostnad når beløpet stemmer — enten mot én
 * linje eller mot summen av et helt bilag (en faktura med flere linjer) — og datoene
 * ligger innenfor 45 dager. Håndverkere taster ofte beløpet inkl. mva,
 * så beløp × 1,25 godtas også. Hver bokført kostnad kan bare erstatte én manuell post.
 *
 * Eksisterende koblinger beholdes; poster brukeren har sagt «ikke samme kjøp» om
 * (`keep_separate`) kobles aldri. Returnerer bare NYE koblinger: manuell id → bokført id.
 */
export function matchManualToBooked(rows: MaterialCostLike[]): Map<string, string> {
  const booked = rows.filter((row) => row.source !== "manual")
  const taken = new Set(rows.map((row) => row.replaced_by).filter((id): id is string => Boolean(id)))

  type Target = { id: string; memberIds: string[]; amount: number; date: string | null }
  const targets: Target[] = []
  for (const row of booked) {
    const amount = Number(row.amount_nok)
    if (amount > 0) targets.push({ id: row.id, memberIds: [row.id], amount, date: row.cost_date })
  }
  // Bilag med flere linjer: summen av linjene er fakturaen håndverkeren tastet inn.
  const byVoucher = new Map<string, typeof booked>()
  for (const row of booked) {
    if (!row.voucher_ref) continue
    const key = `${row.source}:${row.voucher_ref}`
    byVoucher.set(key, [...(byVoucher.get(key) ?? []), row])
  }
  for (const group of byVoucher.values()) {
    if (group.length < 2) continue
    const amount = round(group.reduce((sum, row) => sum + Number(row.amount_nok), 0))
    if (amount <= 0) continue
    const head = [...group].sort((a, b) => Number(b.amount_nok) - Number(a.amount_nok))[0]
    targets.push({ id: head.id, memberIds: group.map((row) => row.id), amount, date: head.cost_date })
  }

  const manual = rows
    .filter((row) => row.source === "manual" && !row.replaced_by && !row.keep_separate)
    .sort((a, b) => String(a.cost_date ?? "").localeCompare(String(b.cost_date ?? "")))

  const matches = new Map<string, string>()
  for (const row of manual) {
    const amount = Number(row.amount_nok)
    if (!(amount > 0)) continue
    let best: { target: Target; distance: number } | null = null
    for (const target of targets) {
      if (target.memberIds.some((id) => taken.has(id))) continue
      if (!sameAmount(amount, target.amount) && !sameAmount(amount, target.amount * 1.25)) continue
      const distance = daysApart(row.cost_date, target.date)
      if (distance > MATCH_WINDOW_DAYS) continue
      if (!best || distance < best.distance) best = { target, distance }
    }
    if (best) {
      matches.set(row.id, best.target.id)
      for (const id of best.target.memberIds) taken.add(id)
    }
  }
  return matches
}

/**
 * Materialkosten prosjektet regnes med: alt som er bokført, pluss manuelle poster
 * som ikke er funnet igjen i regnskapet.
 */
export function summarizeMaterialCosts(rows: MaterialCostLike[]) {
  let bookedNok = 0
  let manualNok = 0
  let replacedNok = 0
  for (const row of rows) {
    const amount = Number(row.amount_nok || 0)
    if (row.source !== "manual") bookedNok += amount
    else if (row.replaced_by) replacedNok += amount
    else manualNok += amount
  }
  return {
    materialCostNok: round(bookedNok + manualNok),
    bookedNok: round(bookedNok),
    manualNok: round(manualNok),
    replacedNok: round(replacedNok),
  }
}
