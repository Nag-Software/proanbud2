import { buildPublicOfferUrl } from "@/lib/tilbud/public-offer"

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

type CustomerEmailInput = {
  recipientName: string
  companyName: string
  intro: string
  ctaLabel: string
  ctaUrl: string
  secondaryText?: string
  /** Optional label/value rows rendered as a summary card above the CTA. */
  detailRows?: Array<{ label: string; value: string }>
}

export function buildCustomerEmailHtml(input: CustomerEmailInput) {
  const secondary = input.secondaryText
    ? `<p style="margin:16px 0 0;color:#6b7280;font-size:14px;line-height:1.5;">${escapeHtml(input.secondaryText)}</p>`
    : ""

  const detailRows = input.detailRows?.length
    ? `
        <table role="presentation" style="width:100%;border-collapse:collapse;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;margin:0 0 24px;">
          <tbody>
            ${input.detailRows
              .map(
                (row, index) => `
              <tr>
                <td style="padding:${index === 0 ? "12px" : "6px"} 16px ${index === input.detailRows!.length - 1 ? "12px" : "6px"};color:#6b7280;font-size:13px;">${escapeHtml(row.label)}</td>
                <td style="padding:${index === 0 ? "12px" : "6px"} 16px ${index === input.detailRows!.length - 1 ? "12px" : "6px"};color:#111827;font-size:13px;font-weight:600;text-align:right;white-space:nowrap;">${escapeHtml(row.value)}</td>
              </tr>`
              )
              .join("")}
          </tbody>
        </table>`
    : ""

  return `
    <div style="font-family:Inter,Arial,sans-serif;background:#f8fafc;padding:32px 16px;">
      <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:32px;">
        <p style="margin:0 0 8px;color:#111827;font-size:16px;">Hei ${escapeHtml(input.recipientName)},</p>
        <p style="margin:0 0 24px;color:#374151;font-size:15px;line-height:1.6;">${escapeHtml(input.intro)}</p>
        ${detailRows}
        <a href="${escapeHtml(input.ctaUrl)}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:12px 20px;border-radius:8px;">
          ${escapeHtml(input.ctaLabel)}
        </a>
        ${secondary}
        <p style="margin:24px 0 0;color:#9ca3af;font-size:12px;line-height:1.5;">
          Du mottar denne e-posten fordi ${escapeHtml(input.companyName)} har kontaktet deg via Proanbud.
        </p>
      </div>
    </div>
  `
}

export function buildOfferSentCustomerEmail(input: {
  recipientName: string
  companyName: string
  projectName?: string | null
  quoteMessage?: string | null
  publicSlug: string
  offerReference?: string | null
  totalInclVatText?: string | null
  validUntilText?: string | null
}) {
  const projectPart = input.projectName ? ` for ${input.projectName}` : ""
  const intro = `${input.companyName} har sendt deg et tilbud${projectPart}. Du kan se hele tilbudet, laste det ned som PDF og svare direkte via lenken under.`
  const secondary = input.quoteMessage?.trim() || undefined

  const detailRows: Array<{ label: string; value: string }> = []
  if (input.offerReference) detailRows.push({ label: "Tilbudsnr.", value: input.offerReference })
  if (input.totalInclVatText) detailRows.push({ label: "Totalt inkl. mva", value: input.totalInclVatText })
  if (input.validUntilText) detailRows.push({ label: "Gyldig til", value: input.validUntilText })

  return buildCustomerEmailHtml({
    recipientName: input.recipientName,
    companyName: input.companyName,
    intro,
    ctaLabel: "Åpne tilbud",
    ctaUrl: buildPublicOfferUrl(input.publicSlug),
    secondaryText: secondary,
    detailRows,
  })
}

export function buildCustomerMessageEmail(input: {
  recipientName: string
  companyName: string
  messagePreview: string
  publicSlug: string
}) {
  return buildCustomerEmailHtml({
    recipientName: input.recipientName,
    companyName: input.companyName,
    intro: `${input.companyName} har sendt deg en melding om tilbudet.`,
    ctaLabel: "Les melding",
    ctaUrl: buildPublicOfferUrl(input.publicSlug, { chat: true }),
    secondaryText: input.messagePreview.slice(0, 180),
  })
}
