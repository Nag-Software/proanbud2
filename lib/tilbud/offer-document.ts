import {
  calculateLineItemTotal,
  calculateLineItemUnitPriceWithMarkup,
  calculateOfferTotals,
  formatNok,
  type OfferCompanyContext,
  type OfferLineItem,
} from "@/lib/tilbud/types"

export type OfferDocumentCustomer = {
  name: string
  email?: string | null
  phone?: string | null
  address?: string | null
  city?: string | null
  orgNumber?: string | null
}

export type OfferDocumentData = {
  title: string
  description?: string
  projectSummary?: string
  quoteMessage?: string
  projectName?: string
  customer: OfferDocumentCustomer
  lineItems: OfferLineItem[]
  company: OfferCompanyContext | null
  issuedDate?: string | Date | null
  validityDays?: number
  quoteValidUntil?: string | null
}

const VAT_RATE = 0.25

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

export function formatOfferDate(value?: string | Date | null) {
  if (!value) return "—"
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return "—"
  return date.toLocaleDateString("no-NO")
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

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

export function buildOfferEmailHtml(data: OfferDocumentData & { offerReference?: string }) {
  const grouped = groupLineItemsBySubproject(data.lineItems)
  const { totals, vatAmountNok, totalInclVatNok } = getOfferDocumentTotals(data.lineItems)
  const issuedDate = formatOfferDate(data.issuedDate || new Date())
  const validityDays = data.validityDays ?? computeValidityDays(String(data.issuedDate || ""), data.quoteValidUntil)
  const companyName = data.company?.name || "Proanbud"
  const customerName = data.customer.name || "—"
  const customerAddress = [data.customer.address, data.customer.city].filter(Boolean).join(", ")
  const title = data.title.trim() || "Tilbud"

  const lineRows = Object.entries(grouped)
    .map(([groupName, items]) => {
      const groupHeader = `
        <tr>
          <td colspan="6" style="padding:12px 0 4px;font-size:10px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#9ca3af;border-bottom:1px solid #e5e7eb;">
            ${escapeHtml(groupName)}
          </td>
        </tr>`

      const itemRows = items
        .map((item) => {
          const description = item.description
            ? `<span style="display:block;font-size:10px;color:#6b7280;line-height:1.4;white-space:pre-line;overflow-wrap:anywhere;">${escapeHtml(item.description)}</span>`
            : ""
          const supplier = item.supplier
            ? `<span style="display:block;font-size:10px;color:#9ca3af;">${escapeHtml(item.supplier)}</span>`
            : ""

          return `
            <tr>
              <td style="padding:8px 12px 8px 0;border-bottom:1px solid #f3f4f6;font-size:11px;color:#111827;">
                <strong>${escapeHtml(item.title)}</strong>
                ${description}
                ${supplier}
              </td>
              <td style="padding:8px 12px 8px 0;border-bottom:1px solid #f3f4f6;font-size:11px;text-align:right;color:#374151;">${item.quantity}</td>
              <td style="padding:8px 12px 8px 0;border-bottom:1px solid #f3f4f6;font-size:11px;text-align:right;color:#6b7280;">${escapeHtml(item.unit)}</td>
              <td style="padding:8px 12px 8px 0;border-bottom:1px solid #f3f4f6;font-size:11px;text-align:right;color:#374151;">${escapeHtml(formatNok(calculateLineItemUnitPriceWithMarkup(item)))}</td>
              <td style="padding:8px 0;border-bottom:1px solid #f3f4f6;font-size:11px;text-align:right;color:#6b7280;">${item.discountPercent > 0 ? `${item.discountPercent}%` : "—"}</td>
              <td style="padding:8px 0 8px 16px;border-bottom:1px solid #f3f4f6;font-size:11px;text-align:right;font-weight:600;color:#111827;">${escapeHtml(formatNok(calculateLineItemTotal(item)))}</td>
            </tr>`
        })
        .join("")

      return groupHeader + itemRows
    })
    .join("")

  const quoteMessageBlock = data.quoteMessage?.trim()
    ? `<p style="margin:8px 0 0;font-size:12px;font-style:italic;color:#6b7280;">"${escapeHtml(data.quoteMessage.trim())}"</p>`
    : ""

  const descriptionBlock = (data.projectSummary?.trim() || data.description?.trim())
    ? `<p style="margin:8px 0 0;font-size:12px;color:#4b5563;line-height:1.5;white-space:pre-line;overflow-wrap:anywhere;">${escapeHtml(data.projectSummary?.trim() || data.description?.trim() || "")}</p>`
    : ""

  return `
    <div style="font-family:Arial,sans-serif;background:#f3f4f6;padding:24px;">
      <div style="max-width:794px;margin:0 auto;background:#ffffff;box-shadow:0 4px 24px rgba(0,0,0,0.12);">
        <div style="display:flex;justify-content:space-between;gap:24px;border-bottom:1px solid #e5e7eb;padding:24px 32px;">
          <div>
            <p style="margin:0;font-size:15px;font-weight:700;color:#030712;">${escapeHtml(companyName)}</p>
            ${data.company?.orgNumber ? `<p style="margin:4px 0 0;font-size:11px;color:#6b7280;">Org.nr. ${escapeHtml(data.company.orgNumber)}</p>` : ""}
          </div>
          <div style="text-align:right;">
            <p style="margin:0;font-size:22px;font-weight:700;color:#030712;">TILBUD</p>
            <p style="margin:4px 0 0;font-size:12px;color:#6b7280;">${escapeHtml(title)}</p>
            <p style="margin:2px 0 0;font-size:12px;color:#6b7280;">Dato: ${escapeHtml(issuedDate)}</p>
            <p style="margin:2px 0 0;font-size:12px;color:#6b7280;">Gyldighet: ${validityDays} dager</p>
          </div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;border-bottom:1px solid #e5e7eb;padding:16px 32px;font-size:12px;">
          <div>
            <p style="margin:0 0 4px;font-size:10px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#9ca3af;">Kunde</p>
            <p style="margin:0;font-weight:600;color:#111827;">${escapeHtml(customerName)}</p>
            ${customerAddress ? `<p style="margin:4px 0 0;color:#4b5563;">${escapeHtml(customerAddress)}</p>` : ""}
            ${data.customer.email ? `<p style="margin:4px 0 0;color:#4b5563;">${escapeHtml(data.customer.email)}</p>` : ""}
            ${data.customer.phone ? `<p style="margin:4px 0 0;color:#4b5563;">${escapeHtml(data.customer.phone)}</p>` : ""}
          </div>
          <div>
            <p style="margin:0 0 4px;font-size:10px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#9ca3af;">Prosjekt</p>
            <p style="margin:0;font-weight:600;color:#111827;">${escapeHtml(data.projectName || "—")}</p>
            ${descriptionBlock}
            ${quoteMessageBlock}
          </div>
        </div>

        <div style="padding:16px 32px;">
          <table style="width:100%;border-collapse:collapse;">
            <thead>
              <tr style="border-bottom:2px solid #111827;text-align:left;">
                <th style="padding:0 12px 6px 0;font-size:10px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#6b7280;">Beskrivelse</th>
                <th style="padding:0 12px 6px 0;font-size:10px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#6b7280;text-align:right;">Antall</th>
                <th style="padding:0 12px 6px 0;font-size:10px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#6b7280;text-align:right;">Enhet</th>
                <th style="padding:0 12px 6px 0;font-size:10px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#6b7280;text-align:right;">Enhetspris</th>
                <th style="padding:0 0 6px;font-size:10px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#6b7280;text-align:right;">Rabatt</th>
                <th style="padding:0 0 6px 16px;font-size:10px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#6b7280;text-align:right;">Beløp</th>
              </tr>
            </thead>
            <tbody>
              ${lineRows || `<tr><td colspan="6" style="padding:24px;text-align:center;color:#6b7280;font-size:12px;">Ingen linjer i tilbudet.</td></tr>`}
            </tbody>
          </table>
        </div>

        <div style="border-top:2px solid #111827;padding:16px 32px;">
          <div style="margin-left:auto;width:224px;font-size:12px;">
            <div style="display:flex;justify-content:space-between;padding:2px 0;">
              <span style="color:#4b5563;">Subtotal eks. mva</span>
              <strong style="color:#111827;">${escapeHtml(formatNok(totals.subtotalNok))}</strong>
            </div>
            ${
              totals.discountNok > 0
                ? `<div style="display:flex;justify-content:space-between;padding:2px 0;">
                    <span style="color:#4b5563;">Rabatt</span>
                    <strong style="color:#111827;">- ${escapeHtml(formatNok(totals.discountNok))}</strong>
                  </div>`
                : ""
            }
            <div style="display:flex;justify-content:space-between;border-top:1px dashed #d1d5db;padding:4px 0;margin-top:4px;">
              <span style="color:#4b5563;">Grunnlag mva (25%)</span>
              <span style="color:#374151;">${escapeHtml(formatNok(totals.subtotalNok))}</span>
            </div>
            <div style="display:flex;justify-content:space-between;padding:2px 0;">
              <span style="color:#4b5563;">Mva 25%</span>
              <span style="color:#374151;">${escapeHtml(formatNok(vatAmountNok))}</span>
            </div>
            <div style="display:flex;justify-content:space-between;border-top:2px solid #111827;padding-top:6px;margin-top:4px;">
              <strong style="color:#030712;">Totalt inkl. mva</strong>
              <strong style="color:#030712;">${escapeHtml(formatNok(totalInclVatNok))}</strong>
            </div>
          </div>
        </div>

        <div style="border-top:1px solid #e5e7eb;background:#f9fafb;padding:12px 32px;font-size:10px;color:#9ca3af;">
          Dette tilbudet er gyldig i ${validityDays} dager fra utstedelsesdato. Alle priser er oppgitt i NOK.
        </div>
      </div>
    </div>
  `.trim()
}

type OfferDocumentRenderOptions = {
  showSupplier?: boolean
  showLogo?: boolean
}

/**
 * Canonical A4 offer sheet rendered with fully inline styles so it looks
 * identical everywhere it is used: the on-screen preview/viewer, the
 * downloaded PDF, and a new browser tab. Mirrors the on-screen React
 * `OfferDocumentPreview` markup.
 */
export function buildOfferDocumentSheet(data: OfferDocumentData, options: OfferDocumentRenderOptions = {}) {
  const { showSupplier = true, showLogo = true } = options
  const grouped = groupLineItemsBySubproject(data.lineItems)
  const { totals, vatAmountNok, totalInclVatNok } = getOfferDocumentTotals(data.lineItems)
  const issuedDate = formatOfferDate(data.issuedDate || new Date())
  const validityDays = data.validityDays ?? computeValidityDays(String(data.issuedDate || ""), data.quoteValidUntil)
  const companyName = data.company?.name || "Proanbud"
  const customerName = data.customer.name || "—"
  const customerAddress = [data.customer.address, data.customer.city].filter(Boolean).join(", ")
  const title = data.title.trim() || "Tilbud"
  const contactLine = [data.company?.email, data.company?.phone].filter(Boolean).join(" · ")
  const logoSrc = data.company?.logoUrl || "/favicon.ico"

  const lineRows = Object.entries(grouped)
    .map(([groupName, items]) => {
      const groupHeader = `
        <tr>
          <td colspan="6" style="padding:12px 0 4px;font-size:10px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#9ca3af;border-bottom:1px solid #e5e7eb;">
            ${escapeHtml(groupName)}
          </td>
        </tr>`

      const itemRows = items
        .map((item) => {
          const description = item.description
            ? `<span style="display:block;font-size:10px;color:#6b7280;line-height:1.4;white-space:pre-line;overflow-wrap:anywhere;">${escapeHtml(item.description)}</span>`
            : ""
          const supplier = showSupplier && item.supplier
            ? `<span style="display:block;font-size:10px;color:#9ca3af;">${escapeHtml(item.supplier)}</span>`
            : ""

          return `
            <tr>
              <td style="padding:8px 12px 8px 0;border-bottom:1px solid #f3f4f6;font-size:11px;color:#111827;">
                <strong>${escapeHtml(item.title)}</strong>
                ${description}
                ${supplier}
              </td>
              <td style="padding:8px 12px 8px 0;border-bottom:1px solid #f3f4f6;font-size:11px;text-align:right;color:#374151;">${item.quantity}</td>
              <td style="padding:8px 12px 8px 0;border-bottom:1px solid #f3f4f6;font-size:11px;text-align:right;color:#6b7280;">${escapeHtml(item.unit)}</td>
              <td style="padding:8px 12px 8px 0;border-bottom:1px solid #f3f4f6;font-size:11px;text-align:right;color:#374151;">${escapeHtml(formatNok(calculateLineItemUnitPriceWithMarkup(item)))}</td>
              <td style="padding:8px 0;border-bottom:1px solid #f3f4f6;font-size:11px;text-align:right;color:#6b7280;">${item.discountPercent > 0 ? `${item.discountPercent}%` : "—"}</td>
              <td style="padding:8px 0 8px 16px;border-bottom:1px solid #f3f4f6;font-size:11px;text-align:right;font-weight:600;color:#111827;">${escapeHtml(formatNok(calculateLineItemTotal(item)))}</td>
            </tr>`
        })
        .join("")

      return groupHeader + itemRows
    })
    .join("")

  const projectText = (data.projectSummary?.trim() || data.description?.trim() || "")
  const descriptionBlock = projectText
    ? `<p style="margin:8px 0 0;font-size:12px;color:#4b5563;line-height:1.5;white-space:pre-line;overflow-wrap:anywhere;">${escapeHtml(projectText)}</p>`
    : ""
  const quoteMessageText = data.quoteMessage?.trim() || ""
  const quoteMessageBlock = quoteMessageText
    ? `<p style="margin:8px 0 0;font-size:12px;font-style:italic;color:#6b7280;white-space:pre-line;overflow-wrap:anywhere;">"${escapeHtml(quoteMessageText)}"</p>`
    : ""

  return `
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:24px;border-bottom:1px solid #e5e7eb;padding:24px 32px;">
      <div style="display:flex;align-items:center;gap:12px;">
        ${showLogo ? `<img src="${escapeHtml(logoSrc)}" alt="Logo" style="height:40px;width:40px;object-fit:contain;" />` : ""}
        <div>
          <p style="margin:0;font-size:15px;font-weight:700;color:#030712;line-height:1.2;">${escapeHtml(companyName)}</p>
          ${data.company?.orgNumber ? `<p style="margin:2px 0 0;font-size:11px;color:#6b7280;">Org.nr. ${escapeHtml(data.company.orgNumber)}</p>` : ""}
          ${contactLine ? `<p style="margin:2px 0 0;font-size:11px;color:#6b7280;">${escapeHtml(contactLine)}</p>` : ""}
        </div>
      </div>
      <div style="text-align:right;">
        <p style="margin:0;font-size:22px;font-weight:700;letter-spacing:-0.01em;color:#030712;">TILBUD</p>
        <p style="margin:4px 0 0;font-size:12px;color:#6b7280;">${escapeHtml(title)}</p>
        <p style="margin:2px 0 0;font-size:12px;color:#6b7280;">Dato: ${escapeHtml(issuedDate)}</p>
        <p style="margin:2px 0 0;font-size:12px;color:#6b7280;">Gyldighet: ${validityDays} dager</p>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;border-bottom:1px solid #e5e7eb;padding:16px 32px;font-size:12px;">
      <div>
        <p style="margin:0 0 4px;font-size:10px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#9ca3af;">Kunde</p>
        <p style="margin:0;font-weight:600;color:#111827;">${escapeHtml(customerName)}</p>
        ${customerAddress ? `<p style="margin:4px 0 0;color:#4b5563;">${escapeHtml(customerAddress)}</p>` : ""}
        ${data.customer.email ? `<p style="margin:2px 0 0;color:#4b5563;">${escapeHtml(data.customer.email)}</p>` : ""}
        ${data.customer.phone ? `<p style="margin:2px 0 0;color:#4b5563;">${escapeHtml(data.customer.phone)}</p>` : ""}
      </div>
      <div>
        <p style="margin:0 0 4px;font-size:10px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#9ca3af;">Prosjekt</p>
        <p style="margin:0;font-weight:600;color:#111827;">${escapeHtml(data.projectName || "—")}</p>
        ${descriptionBlock}
        ${quoteMessageBlock}
      </div>
    </div>

    <div style="padding:16px 32px;">
      <table style="width:100%;border-collapse:collapse;">
        <thead>
          <tr style="border-bottom:2px solid #111827;text-align:left;">
            <th style="padding:0 12px 6px 0;font-size:10px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#6b7280;">Beskrivelse</th>
            <th style="padding:0 12px 6px 0;font-size:10px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#6b7280;text-align:right;">Antall</th>
            <th style="padding:0 12px 6px 0;font-size:10px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#6b7280;text-align:right;">Enhet</th>
            <th style="padding:0 12px 6px 0;font-size:10px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#6b7280;text-align:right;">Enhetspris</th>
            <th style="padding:0 0 6px;font-size:10px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#6b7280;text-align:right;">Rabatt</th>
            <th style="padding:0 0 6px 16px;font-size:10px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#6b7280;text-align:right;">Beløp</th>
          </tr>
        </thead>
        <tbody>
          ${lineRows || `<tr><td colspan="6" style="padding:24px;text-align:center;color:#6b7280;font-size:12px;">Ingen linjer i tilbudet.</td></tr>`}
        </tbody>
      </table>
    </div>

    <div style="border-top:2px solid #111827;padding:16px 32px;">
      <div style="margin-left:auto;width:224px;font-size:12px;">
        <div style="display:flex;justify-content:space-between;padding:2px 0;">
          <span style="color:#4b5563;">Subtotal eks. mva</span>
          <strong style="color:#111827;">${escapeHtml(formatNok(totals.subtotalNok))}</strong>
        </div>
        ${
          totals.discountNok > 0
            ? `<div style="display:flex;justify-content:space-between;padding:2px 0;">
                <span style="color:#4b5563;">Rabatt</span>
                <strong style="color:#111827;">- ${escapeHtml(formatNok(totals.discountNok))}</strong>
              </div>`
            : ""
        }
        <div style="display:flex;justify-content:space-between;border-top:1px dashed #d1d5db;padding:4px 0;margin-top:4px;">
          <span style="color:#4b5563;">Grunnlag mva (25%)</span>
          <span style="color:#374151;">${escapeHtml(formatNok(totals.subtotalNok))}</span>
        </div>
        <div style="display:flex;justify-content:space-between;padding:2px 0;">
          <span style="color:#4b5563;">Mva 25%</span>
          <span style="color:#374151;">${escapeHtml(formatNok(vatAmountNok))}</span>
        </div>
        <div style="display:flex;justify-content:space-between;border-top:2px solid #111827;padding-top:6px;margin-top:4px;">
          <strong style="color:#030712;">Totalt inkl. mva</strong>
          <strong style="color:#030712;">${escapeHtml(formatNok(totalInclVatNok))}</strong>
        </div>
      </div>
    </div>

    <div style="border-top:1px solid #e5e7eb;background:#f9fafb;padding:12px 32px;font-size:10px;color:#9ca3af;">
      Dette tilbudet er gyldig i ${validityDays} dager fra utstedelsesdato. Alle priser er oppgitt i NOK.
    </div>
  `.trim()
}

type OfferDocumentPageOptions = OfferDocumentRenderOptions & {
  autoPrint?: boolean
}

/**
 * Full, self-contained HTML page wrapping the canonical sheet on an A4 page.
 * Suitable for `iframe srcDoc`, opening in a new tab, and printing/saving as PDF.
 */
export function buildOfferDocumentPage(data: OfferDocumentData, options: OfferDocumentPageOptions = {}) {
  const { autoPrint = false, ...renderOptions } = options
  const sheet = buildOfferDocumentSheet(data, renderOptions)
  const docTitle = data.title.trim() || "Tilbud"

  return `<!DOCTYPE html>
<html lang="no">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(docTitle)}</title>
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { background: #e8e6e1; font-family: Arial, Helvetica, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .a4-viewport { padding: 16px; display: flex; justify-content: center; }
  .a4-page { width: 210mm; min-height: 297mm; background: #ffffff; box-shadow: 0 4px 24px rgba(0,0,0,0.18); }
  @media print {
    body { background: #ffffff; }
    .a4-viewport { padding: 0; }
    .a4-page { width: auto; min-height: auto; box-shadow: none; }
  }
</style>
</head>
<body>
<div class="a4-viewport"><div class="a4-page">${sheet}</div></div>
${autoPrint ? '<script>window.onload=function(){setTimeout(function(){window.focus();window.print();},350);};</script>' : ""}
</body>
</html>`
}
