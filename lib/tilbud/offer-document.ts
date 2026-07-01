import {
  calculateLineItemTotal,
  calculateLineItemUnitPriceWithMarkupBeforeDiscount,
  calculateOfferTotals,
  type OfferCompanyContext,
  type OfferContractBasis,
  type OfferLineItem,
  type OfferPaymentScheduleEntry,
  type OfferPricingModel,
} from "@/lib/tilbud/types"

export type OfferDocumentCustomer = {
  name: string
  email?: string | null
  phone?: string | null
  address?: string | null
  postalCode?: string | null
  city?: string | null
  orgNumber?: string | null
}

/**
 * Evidence for a digitally accepted offer. When present, the document renders
 * an acceptance-evidence block instead of blank signature lines — the offer
 * document IS the binding agreement.
 */
export type OfferDocumentAcceptance = {
  name: string
  email: string
  acceptedAt: string
  method: "email_otp"
  documentSha256: string
}

export type OfferDocumentData = {
  title: string
  description?: string
  projectSummary?: string
  quoteMessage?: string
  projectName?: string
  /** Short human-readable reference (e.g. first UUID chunk), shown as "Tilbudsnr." */
  offerReference?: string | null
  customer: OfferDocumentCustomer
  lineItems: OfferLineItem[]
  company: OfferCompanyContext | null
  issuedDate?: string | Date | null
  validityDays?: number
  quoteValidUntil?: string | null
  paymentSchedule?: OfferPaymentScheduleEntry[] | null
  pricingModel?: OfferPricingModel | null
  contractBasis?: OfferContractBasis | null
  acceptance?: OfferDocumentAcceptance | null
}

const VAT_RATE = 0.25

export const PRICING_MODEL_LABELS: Record<OfferPricingModel, string> = {
  fixed: "Fastpris",
  time_materials: "Regningsarbeid (medgått tid og materialer)",
  unit_price: "Enhetspriser",
  mixed: "Kombinasjon av fastpris og regningsarbeid",
}

export const CONTRACT_BASIS_LABELS: Record<Exclude<OfferContractBasis, "none">, string> = {
  ns8405: "NS 8405",
  ns8407: "NS 8407",
  custom: "Egne kontraktsvilkår",
}

export function formatOfferReference(id: string) {
  const normalized = id.trim()
  if (!normalized) return "UKJENT"

  const firstChunk = normalized.split("-")[0]
  if (firstChunk) {
    return firstChunk.toUpperCase()
  }

  return normalized.slice(0, 8).toUpperCase()
}

export function groupLineItemsBySubproject(lineItems: OfferLineItem[]) {
  return lineItems.reduce<Record<string, OfferLineItem[]>>((groups, item) => {
    const key = item.subproject || "Generelt"
    if (!groups[key]) {
      groups[key] = []
    }
    groups[key].push(item)
    return groups
  }, {})
}

export function computeValidityDays(createdAt: string | null | undefined, quoteValidUntil: string | null | undefined) {
  if (!quoteValidUntil) return 30

  const start = createdAt ? new Date(createdAt) : new Date()
  const end = new Date(quoteValidUntil)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 30

  const diff = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24))
  return Math.max(1, diff)
}

/**
 * Resolve the explicit expiry date for the offer: the stored `quoteValidUntil`
 * when present, otherwise issued date + validity days. Returns null when no
 * sensible date can be derived.
 */
export function computeValidUntilDate(
  issuedDate: string | Date | null | undefined,
  quoteValidUntil: string | null | undefined,
  validityDays?: number
): Date | null {
  if (quoteValidUntil) {
    const parsed = new Date(quoteValidUntil)
    if (!Number.isNaN(parsed.getTime())) return parsed
  }

  const start = issuedDate ? new Date(issuedDate) : new Date()
  if (Number.isNaN(start.getTime())) return null

  const days = validityDays && validityDays > 0 ? validityDays : 30
  return new Date(start.getTime() + days * 24 * 60 * 60 * 1000)
}

export function formatOfferDate(value?: string | Date | null) {
  if (!value) return "—"
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return "—"
  return new Intl.DateTimeFormat("nb-NO", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date)
}

export function formatOfferDateTime(value?: string | Date | null) {
  if (!value) return "—"
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return "—"
  return `${new Intl.DateTimeFormat("nb-NO", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Europe/Oslo",
  }).format(date)} kl. ${new Intl.DateTimeFormat("nb-NO", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Oslo",
  }).format(date)}`
}

/**
 * Document money formatting: quotes/invoices always show øre (2 decimals) so
 * line sums and VAT reconcile exactly. Plain variant (no "kr") is used in
 * table cells, currency variant in the totals block.
 */
export function formatDocumentAmount(value: number) {
  return new Intl.NumberFormat("nb-NO", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
    Number.isFinite(value) ? value : 0
  )
}

export function formatDocumentCurrency(value: number) {
  return new Intl.NumberFormat("nb-NO", {
    style: "currency",
    currency: "NOK",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(value) ? value : 0)
}

export function formatDocumentQuantity(value: number) {
  return new Intl.NumberFormat("nb-NO", { maximumFractionDigits: 2 }).format(Number.isFinite(value) ? value : 0)
}

const UNIT_DISPLAY: Record<string, string> = { m2: "m²", M2: "m²", m3: "m³", M3: "m³" }

export function formatDocumentUnit(unit: string) {
  return UNIT_DISPLAY[unit.trim()] || unit
}

export function calculateGroupTotal(items: OfferLineItem[]) {
  return items.reduce((sum, item) => sum + calculateLineItemTotal(item), 0)
}

export function getOfferDocumentTotals(lineItems: OfferLineItem[]) {
  const totals = calculateOfferTotals(lineItems)
  const vatAmountNok = Math.round(totals.subtotalNok * VAT_RATE * 100) / 100
  const totalInclVatNok = Math.round((totals.subtotalNok + vatAmountNok) * 100) / 100

  return {
    totals,
    vatAmountNok,
    totalInclVatNok,
  }
}

export function normalizePaymentSchedule(entries: OfferPaymentScheduleEntry[] | null | undefined) {
  if (!Array.isArray(entries)) return []
  return entries
    .map((entry) => ({
      label: String(entry?.label || "").trim(),
      percent: Number(entry?.percent || 0),
      dueDescription: entry?.dueDescription ? String(entry.dueDescription).trim() : "",
    }))
    .filter((entry) => entry.label.length > 0 && entry.percent > 0)
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

/**
 * The company identity line shown at the foot of the document — shared between
 * the sheet, the React preview and the PDF page-footer template.
 */
export function buildOfferFooterParts(company: OfferCompanyContext | null) {
  return [
    company?.name || "Proanbud",
    company?.orgNumber ? `Org.nr. ${company.orgNumber}` : null,
    company?.phone,
    company?.email,
    company?.website,
  ].filter(Boolean) as string[]
}

type OfferDocumentRenderOptions = {
  showSupplier?: boolean
  showLogo?: boolean
}

/**
 * Shared derived view-model so the HTML sheet and the React preview render the
 * exact same content decisions (which columns, which sections, which labels).
 */
export function buildOfferDocumentModel(data: OfferDocumentData) {
  const grouped = groupLineItemsBySubproject(data.lineItems)
  const groupEntries = Object.entries(grouped)
  const { totals, vatAmountNok, totalInclVatNok } = getOfferDocumentTotals(data.lineItems)
  const preDiscountSubtotalNok = Math.round((totals.subtotalNok + totals.discountNok) * 100) / 100
  const hasDiscount = totals.discountNok > 0

  const issuedDate = data.issuedDate || new Date()
  const validityDays = data.validityDays ?? computeValidityDays(String(data.issuedDate || ""), data.quoteValidUntil)
  const validUntil = computeValidUntilDate(issuedDate, data.quoteValidUntil, validityDays)

  const paymentSchedule = normalizePaymentSchedule(data.paymentSchedule)
  const pricingModelLabel = data.pricingModel ? PRICING_MODEL_LABELS[data.pricingModel] : ""
  const contractBasisLabel =
    data.contractBasis && data.contractBasis !== "none" ? CONTRACT_BASIS_LABELS[data.contractBasis] : ""

  // Hide the group scaffolding when everything lives in the default bucket.
  const showGroups = groupEntries.length > 1 || (groupEntries.length === 1 && groupEntries[0][0] !== "Generelt")

  const companyAddressLine = [data.company?.postalCode, data.company?.city].filter(Boolean).join(" ")
  const customerAddressLine = [data.customer.postalCode, data.customer.city].filter(Boolean).join(" ")

  return {
    groupEntries,
    totals,
    vatAmountNok,
    totalInclVatNok,
    preDiscountSubtotalNok,
    hasDiscount,
    issuedDate,
    validityDays,
    validUntil,
    paymentSchedule,
    pricingModelLabel,
    contractBasisLabel,
    showGroups,
    companyAddressLine,
    customerAddressLine,
    title: data.title.trim() || "Tilbud",
    companyName: data.company?.name || "Proanbud",
    customerName: data.customer.name.trim() || "—",
    introText: data.projectSummary?.trim() || data.description?.trim() || "",
    quoteMessage: data.quoteMessage?.trim() || "",
  }
}

/**
 * Canonical A4 offer sheet rendered with fully inline styles so it looks
 * identical everywhere it is used: the on-screen preview/viewer, the
 * downloaded PDF, and a new browser tab. Mirrors the on-screen React
 * `OfferDocumentPreview` markup.
 */
export function buildOfferDocumentSheet(data: OfferDocumentData, options: OfferDocumentRenderOptions = {}) {
  const { showSupplier = true, showLogo = true } = options
  const m = buildOfferDocumentModel(data)
  const company = data.company

  const logoSrc = showLogo && company?.logoUrl ? company.logoUrl : null

  // ---------- header ----------
  const headerLeft = `
    <div style="display:flex;align-items:center;gap:14px;min-width:0;">
      ${logoSrc ? `<img src="${escapeHtml(logoSrc)}" alt="" style="height:46px;max-width:170px;object-fit:contain;object-position:left center;" />` : ""}
      <p style="margin:0;font-size:${logoSrc ? "16px" : "20px"};font-weight:700;letter-spacing:-0.01em;color:#111827;line-height:1.2;">${escapeHtml(m.companyName)}</p>
    </div>`

  const headerRight = `
    <div style="text-align:right;flex-shrink:0;">
      <p style="margin:0;font-size:26px;font-weight:800;letter-spacing:0.02em;color:#111827;line-height:1;">TILBUD</p>
      ${data.offerReference ? `<p style="margin:7px 0 0;font-size:11.5px;font-weight:600;color:#111827;">Tilbudsnr. ${escapeHtml(data.offerReference)}</p>` : ""}
      <p style="margin:${data.offerReference ? "2px" : "7px"} 0 0;font-size:11px;color:#6b7280;">Dato: ${escapeHtml(formatOfferDate(m.issuedDate))}</p>
      ${m.validUntil ? `<p style="margin:2px 0 0;font-size:11px;color:#6b7280;">Gyldig til: ${escapeHtml(formatOfferDate(m.validUntil))}</p>` : ""}
    </div>`

  // ---------- party blocks ----------
  const partyLine = (value: string | null | undefined, opts?: { strong?: boolean }) =>
    value
      ? `<p style="margin:0 0 2px;font-size:11px;line-height:1.5;color:${opts?.strong ? "#111827" : "#4b5563"};${opts?.strong ? "font-weight:600;font-size:12px;" : ""}">${escapeHtml(value)}</p>`
      : ""

  const partyLabel = (label: string) =>
    `<p style="margin:0 0 5px;font-size:9.5px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#9ca3af;">${label}</p>`

  const companyBlock = `
    <div>
      ${partyLabel("Fra")}
      ${partyLine(m.companyName, { strong: true })}
      ${partyLine(company?.address)}
      ${partyLine(m.companyAddressLine)}
      ${partyLine(company?.orgNumber ? `Org.nr. ${company.orgNumber}` : null)}
      ${partyLine(company?.phone ? `Tlf. ${company.phone}` : null)}
      ${partyLine(company?.email)}
      ${partyLine(company?.website)}
    </div>`

  const customerBlock = `
    <div>
      ${partyLabel("Tilbud til")}
      ${partyLine(m.customerName, { strong: true })}
      ${partyLine(data.customer.address)}
      ${partyLine(m.customerAddressLine)}
      ${partyLine(data.customer.orgNumber ? `Org.nr. ${data.customer.orgNumber}` : null)}
      ${partyLine(data.customer.phone ? `Tlf. ${data.customer.phone}` : null)}
      ${partyLine(data.customer.email)}
    </div>`

  // ---------- title + intro ----------
  const introBlock = `
    <div class="avoid-break" style="padding:18px 48px 4px;">
      <h1 style="margin:0;font-size:16px;font-weight:700;letter-spacing:-0.01em;color:#111827;">${escapeHtml(m.title)}</h1>
      ${data.projectName ? `<p style="margin:3px 0 0;font-size:11px;color:#6b7280;">Prosjekt: ${escapeHtml(data.projectName)}</p>` : ""}
      ${m.introText ? `<p style="margin:10px 0 0;font-size:11.5px;color:#374151;line-height:1.6;white-space:pre-line;overflow-wrap:anywhere;">${escapeHtml(m.introText)}</p>` : ""}
      ${m.quoteMessage ? `<p style="margin:10px 0 0;padding-left:10px;border-left:2px solid #d1d5db;font-size:11.5px;font-style:italic;color:#6b7280;line-height:1.6;white-space:pre-line;overflow-wrap:anywhere;">${escapeHtml(m.quoteMessage)}</p>` : ""}
    </div>`

  // ---------- line item table ----------
  const showDiscountColumn = data.lineItems.some((item) => item.discountPercent > 0)
  const columnCount = showDiscountColumn ? 7 : 6

  const th = (label: string, opts?: { align?: string; width?: string; paddingLeft?: string }) =>
    `<th style="padding:0 0 7px ${opts?.paddingLeft || "0"};${opts?.width ? `width:${opts.width};` : ""}font-size:9.5px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#6b7280;text-align:${opts?.align || "left"};">${label}</th>`

  const tableHead = `
    <thead>
      <tr style="border-bottom:1px solid #111827;">
        ${th("#", { width: "26px" })}
        ${th("Beskrivelse")}
        ${th("Antall", { align: "right", width: "52px" })}
        ${th("Enhet", { align: "right", width: "46px" })}
        ${th("À-pris", { align: "right", width: "76px" })}
        ${showDiscountColumn ? th("Rabatt", { align: "right", width: "52px" }) : ""}
        ${th("Beløp", { align: "right", width: "86px", paddingLeft: "14px" })}
      </tr>
    </thead>`

  let position = 0
  const bodyRows = m.groupEntries
    .map(([groupName, items]) => {
      // break-after: avoid keeps the group header glued to its first item row
      // instead of being orphaned at the bottom of a page.
      const groupHeader = m.showGroups
        ? `
        <tr style="break-after:avoid;page-break-after:avoid;">
          <td colspan="${columnCount - 1}" style="padding:14px 0 4px;border-bottom:1px solid #e5e7eb;font-size:10px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#111827;">${escapeHtml(groupName)}</td>
          <td style="padding:14px 0 4px 14px;border-bottom:1px solid #e5e7eb;font-size:10px;font-weight:600;color:#9ca3af;text-align:right;white-space:nowrap;">${escapeHtml(formatDocumentAmount(calculateGroupTotal(items)))}</td>
        </tr>`
        : ""

      const itemRows = items
        .map((item) => {
          position += 1
          const description = item.description
            ? `<span style="display:block;margin-top:1px;font-size:10px;font-weight:400;color:#6b7280;line-height:1.45;white-space:pre-line;overflow-wrap:anywhere;">${escapeHtml(item.description)}</span>`
            : ""
          const supplier =
            showSupplier && item.supplier
              ? `<span style="display:block;margin-top:1px;font-size:9.5px;font-weight:400;color:#9ca3af;">${escapeHtml(item.supplier)}</span>`
              : ""

          const cell = (content: string, opts?: { align?: string; color?: string; weight?: string; paddingLeft?: string; nowrap?: boolean }) =>
            `<td style="padding:7px 0 7px ${opts?.paddingLeft || "0"};border-bottom:1px solid #f3f4f6;font-size:11px;vertical-align:top;color:${opts?.color || "#374151"};text-align:${opts?.align || "left"};${opts?.weight ? `font-weight:${opts.weight};` : ""}${opts?.nowrap ? "white-space:nowrap;" : ""}font-variant-numeric:tabular-nums;">${content}</td>`

          return `
            <tr>
              ${cell(String(position), { color: "#9ca3af" })}
              ${cell(`<span style="font-weight:600;color:#111827;">${escapeHtml(item.title)}</span>${description}${supplier}`, {})}
              ${cell(escapeHtml(formatDocumentQuantity(item.quantity)), { align: "right", nowrap: true })}
              ${cell(escapeHtml(formatDocumentUnit(item.unit)), { align: "right", color: "#6b7280" })}
              ${cell(escapeHtml(formatDocumentAmount(calculateLineItemUnitPriceWithMarkupBeforeDiscount(item))), { align: "right", nowrap: true })}
              ${showDiscountColumn ? cell(item.discountPercent > 0 ? `${escapeHtml(formatDocumentQuantity(item.discountPercent))} %` : "–", { align: "right", color: "#6b7280", nowrap: true }) : ""}
              ${cell(escapeHtml(formatDocumentAmount(calculateLineItemTotal(item))), { align: "right", weight: "600", color: "#111827", paddingLeft: "14px", nowrap: true })}
            </tr>`
        })
        .join("")

      return groupHeader + itemRows
    })
    .join("")

  const emptyRow = `<tr><td colspan="${columnCount}" style="padding:24px 0;text-align:center;color:#6b7280;font-size:11.5px;">Ingen linjer i tilbudet.</td></tr>`

  const tableBlock = `
    <div style="padding:14px 48px 0;">
      <table style="width:100%;border-collapse:collapse;">
        ${tableHead}
        <tbody>
          ${bodyRows || emptyRow}
        </tbody>
      </table>
    </div>`

  // ---------- totals ----------
  const totalsRow = (label: string, value: string, opts?: { muted?: boolean }) => `
    <div style="display:flex;justify-content:space-between;gap:16px;padding:3px 0;">
      <span style="font-size:11.5px;color:${opts?.muted ? "#6b7280" : "#4b5563"};">${label}</span>
      <span style="font-size:11.5px;color:#111827;font-variant-numeric:tabular-nums;white-space:nowrap;">${value}</span>
    </div>`

  const totalsBlock = `
    <div class="avoid-break" style="padding:14px 48px 0;display:flex;justify-content:flex-end;">
      <div style="width:270px;">
        ${totalsRow("Sum eks. mva", escapeHtml(formatDocumentCurrency(m.preDiscountSubtotalNok)))}
        ${m.hasDiscount ? totalsRow("Rabatt", `− ${escapeHtml(formatDocumentCurrency(m.totals.discountNok))}`) : ""}
        ${m.hasDiscount ? totalsRow("Nettosum eks. mva", escapeHtml(formatDocumentCurrency(m.totals.subtotalNok))) : ""}
        ${totalsRow("Mva (25 %)", escapeHtml(formatDocumentCurrency(m.vatAmountNok)), { muted: true })}
        <div style="margin-top:6px;display:flex;justify-content:space-between;gap:16px;align-items:baseline;border-top:1px solid #111827;padding:7px 0 0;">
          <span style="font-size:12px;font-weight:700;color:#111827;">Totalt inkl. mva</span>
          <span style="font-size:14px;font-weight:700;color:#111827;font-variant-numeric:tabular-nums;white-space:nowrap;">${escapeHtml(formatDocumentCurrency(m.totalInclVatNok))}</span>
        </div>
      </div>
    </div>`

  // ---------- payment schedule ----------
  const paymentBlock = m.paymentSchedule.length
    ? `
    <div class="avoid-break" style="padding:22px 48px 0;">
      ${sectionLabel("Betalingsplan")}
      <div style="border-top:1px solid #e5e7eb;">
        ${m.paymentSchedule
          .map(
            (entry) => `
          <div style="display:flex;justify-content:space-between;gap:16px;padding:6px 0;border-bottom:1px solid #f3f4f6;">
            <span style="font-size:11px;color:#374151;">${escapeHtml(entry.label)}${entry.dueDescription ? `<span style="color:#9ca3af;"> — ${escapeHtml(entry.dueDescription)}</span>` : ""}</span>
            <span style="font-size:11px;color:#111827;font-variant-numeric:tabular-nums;white-space:nowrap;">${escapeHtml(formatDocumentQuantity(entry.percent))} % · ${escapeHtml(formatDocumentCurrency(Math.round(m.totalInclVatNok * entry.percent) / 100))}</span>
          </div>`
          )
          .join("")}
      </div>
    </div>`
    : ""

  // ---------- terms ----------
  const termsItems: string[] = []
  if (m.validUntil) {
    termsItems.push(`Tilbudet er gyldig til ${formatOfferDate(m.validUntil)} (${m.validityDays} dager fra utstedelsesdato).`)
  } else {
    termsItems.push(`Tilbudet er gyldig i ${m.validityDays} dager fra utstedelsesdato.`)
  }
  if (m.pricingModelLabel) termsItems.push(`Prismodell: ${m.pricingModelLabel}.`)
  if (m.contractBasisLabel) termsItems.push(`Kontraktsgrunnlag: ${m.contractBasisLabel}.`)
  termsItems.push("Alle priser er oppgitt i norske kroner. Merverdiavgift (25 %) er spesifisert.")

  const termsBlock = `
    <div class="avoid-break" style="padding:22px 48px 0;">
      ${sectionLabel("Forutsetninger og vilkår")}
      <ul style="margin:0;padding:0 0 0 16px;">
        ${termsItems.map((item) => `<li style="font-size:10.5px;color:#4b5563;line-height:1.7;">${escapeHtml(item)}</li>`).join("")}
      </ul>
    </div>`

  // ---------- acceptance ----------
  const evidenceRow = (label: string, value: string) => `
    <div style="display:flex;gap:12px;padding:3px 0;">
      <span style="width:150px;flex-shrink:0;font-size:10px;color:#6b7280;">${escapeHtml(label)}</span>
      <span style="font-size:10px;font-weight:600;color:#111827;overflow-wrap:anywhere;">${escapeHtml(value)}</span>
    </div>`

  const acceptanceBlock = data.acceptance
    ? `
    <div class="avoid-break" style="padding:22px 48px 8px;">
      ${sectionLabel("Aksept av tilbud")}
      <div style="border:1px solid #e5e7eb;border-radius:6px;padding:12px 14px;background:#fafafa;">
        <p style="margin:0 0 8px;font-size:10.5px;font-weight:600;color:#111827;">Tilbudet er akseptert digitalt ${escapeHtml(formatOfferDateTime(data.acceptance.acceptedAt))}. Aksepten utgjør en bindende avtale om leveransen beskrevet i dette dokumentet.</p>
        ${evidenceRow("Akseptert av", data.acceptance.name)}
        ${evidenceRow("Bekreftet via engangskode til", data.acceptance.email)}
        ${evidenceRow("Dokument-ID (SHA-256)", data.acceptance.documentSha256)}
      </div>
    </div>`
    : `
    <div class="avoid-break" style="padding:22px 48px 8px;">
      ${sectionLabel("Aksept av tilbud")}
      <p style="margin:0;font-size:10.5px;color:#4b5563;line-height:1.6;">Tilbudet aksepteres via tilbudslenken dere har mottatt, eller ved signering nedenfor. Aksept utgjør en bindende avtale om leveransen beskrevet i dette tilbudet.</p>
      <div style="display:flex;gap:40px;margin-top:30px;">
        <div style="flex:1;border-top:1px solid #9ca3af;padding-top:5px;font-size:10px;color:#6b7280;">Sted / dato</div>
        <div style="flex:1;border-top:1px solid #9ca3af;padding-top:5px;font-size:10px;color:#6b7280;">Signatur ${escapeHtml(m.customerName)}</div>
      </div>
    </div>`

  // ---------- footer ----------
  const footerParts = buildOfferFooterParts(company)

  const footerBlock = `
    <div class="offer-footer" style="margin-top:28px;border-top:1px solid #e5e7eb;padding:12px 48px 20px;">
      <p style="margin:0;font-size:9.5px;color:#9ca3af;text-align:center;letter-spacing:0.02em;">${footerParts.map((part) => escapeHtml(part)).join(" &nbsp;·&nbsp; ")}</p>
    </div>`

  return `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:24px;padding:34px 48px 20px;">
      ${headerLeft}
      ${headerRight}
    </div>
    <div style="margin:0 48px;border-top:1px solid #d1d5db;"></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:32px;padding:16px 48px 0;">
      ${companyBlock}
      ${customerBlock}
    </div>
    ${introBlock}
    ${tableBlock}
    <div style="margin:0 48px;border-top:1px solid #111827;"></div>
    ${totalsBlock}
    ${paymentBlock}
    ${termsBlock}
    ${acceptanceBlock}
    ${footerBlock}
  `.trim()
}

function sectionLabel(label: string) {
  return `<p style="margin:0 0 6px;font-size:9.5px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#9ca3af;">${escapeHtml(label)}</p>`
}

type OfferDocumentPageOptions = OfferDocumentRenderOptions & {
  autoPrint?: boolean
  /**
   * Extra CSS injected into the page head — used by the server PDF route to
   * embed the Satoshi font as a base64 @font-face so the PDF matches the app.
   */
  fontFaceCss?: string
  /**
   * "css": page margins come from the stylesheet's @page rule (browser print /
   * new tab). "external": margins are supplied by the caller (Puppeteer's
   * page.pdf margin option), so the stylesheet keeps @page margins at 0.
   */
  printMarginMode?: "css" | "external"
}

/**
 * Full, self-contained HTML page wrapping the canonical sheet on an A4 page.
 * Suitable for `iframe srcDoc`, opening in a new tab, and printing/saving as PDF.
 */
export function buildOfferDocumentPage(data: OfferDocumentData, options: OfferDocumentPageOptions = {}) {
  const { autoPrint = false, fontFaceCss = "", printMarginMode = "css", ...renderOptions } = options
  const sheet = buildOfferDocumentSheet(data, renderOptions)
  const docTitle = data.title.trim() || "Tilbud"
  const pageMargin = printMarginMode === "css" ? "10mm 0 14mm" : "0"
  // In "external" mode Puppeteer's repeating page footer carries the company
  // line, so the in-content footer strip would duplicate it.
  const printFooterCss =
    printMarginMode === "external"
      ? ".a4-page .offer-footer { display: none; }"
      : ".a4-page .offer-footer { margin-top: 28px; }"

  return `<!DOCTYPE html>
<html lang="no">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(docTitle)}</title>
<style>
  ${fontFaceCss}
  @page { size: A4; margin: ${pageMargin}; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { background: #e8e6e1; font-family: "Satoshi", "Inter", -apple-system, "Segoe UI", Arial, Helvetica, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; text-rendering: optimizeLegibility; }
  .a4-viewport { padding: 16px; display: flex; justify-content: center; }
  .a4-page { width: 210mm; min-height: 297mm; background: #ffffff; box-shadow: 0 4px 24px rgba(0,0,0,0.18); display: flex; flex-direction: column; }
  .a4-page .offer-footer { margin-top: auto; }
  table { width: 100%; border-collapse: collapse; }
  thead { display: table-header-group; }
  tr { break-inside: avoid; page-break-inside: avoid; }
  .avoid-break { break-inside: avoid; page-break-inside: avoid; }
  @media print {
    body { background: #ffffff; }
    .a4-viewport { padding: 0; }
    /* Block layout while printing: flex containers fragment poorly across pages. */
    .a4-page { display: block; width: auto; min-height: auto; box-shadow: none; }
    ${printFooterCss}
  }
</style>
</head>
<body>
<div class="a4-viewport"><div class="a4-page">${sheet}</div></div>
${autoPrint ? '<script>window.onload=function(){setTimeout(function(){window.focus();window.print();},350);};</script>' : ""}
</body>
</html>`
}
