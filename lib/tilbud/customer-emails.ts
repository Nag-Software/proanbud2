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
}

export function buildCustomerEmailHtml(input: CustomerEmailInput) {
  const secondary = input.secondaryText
    ? `<p style="margin:16px 0 0;color:#6b7280;font-size:14px;line-height:1.5;">${escapeHtml(input.secondaryText)}</p>`
    : ""

  return `
    <div style="font-family:Inter,Arial,sans-serif;background:#f8fafc;padding:32px 16px;">
      <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:32px;">
        <p style="margin:0 0 8px;color:#111827;font-size:16px;">Hei ${escapeHtml(input.recipientName)},</p>
        <p style="margin:0 0 24px;color:#374151;font-size:15px;line-height:1.6;">${escapeHtml(input.intro)}</p>
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
}) {
  const projectPart = input.projectName ? ` for ${input.projectName}` : ""
  const intro = `${input.companyName} har sendt deg et tilbud${projectPart}.`
  const secondary = input.quoteMessage?.trim() || undefined

  return buildCustomerEmailHtml({
    recipientName: input.recipientName,
    companyName: input.companyName,
    intro,
    ctaLabel: "Åpne tilbud",
    ctaUrl: buildPublicOfferUrl(input.publicSlug),
    secondaryText: secondary,
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
