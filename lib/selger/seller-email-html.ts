import { LEGAL_COMPANY } from "@/lib/legal/company"

export type SellerEmailHtmlInput = {
  recipientName: string
  headline?: string
  paragraphs: string[]
  steps?: { title: string; body: string }[]
  bullets?: string[]
  customMessage?: string | null
  ctaLabel: string
  ctaUrl: string
  fallbackUrl?: string
  secondaryText?: string
}

const appUrl = () => process.env.NEXT_PUBLIC_APP_URL?.trim() || "https://nye.proanbud.no"

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

export function paragraphsFromText(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean)
}

function renderParagraphs(paragraphs: string[]) {
  return paragraphs
    .map(
      (paragraph) =>
        `<p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.65;">${escapeHtml(paragraph)}</p>`
    )
    .join("")
}

function renderSteps(steps: { title: string; body: string }[]) {
  const items = steps
    .map(
      (step, index) => `
        <tr>
          <td style="vertical-align:top;padding:0 14px 20px 0;width:32px;">
            <div style="width:28px;height:28px;border-radius:50%;background:#151515;color:#ffffff;font-size:13px;font-weight:700;line-height:28px;text-align:center;">
              ${index + 1}
            </div>
          </td>
          <td style="vertical-align:top;padding:0 0 20px;">
            <p style="margin:0 0 4px;color:#151515;font-size:15px;font-weight:600;line-height:1.4;">${escapeHtml(step.title)}</p>
            <p style="margin:0;color:#6b7280;font-size:14px;line-height:1.55;">${escapeHtml(step.body)}</p>
          </td>
        </tr>
      `
    )
    .join("")

  return `
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:8px 0 24px;border-collapse:collapse;">
      ${items}
    </table>
  `
}

function renderBullets(bullets: string[]) {
  const items = bullets
    .map(
      (bullet) =>
        `<li style="margin:0 0 10px;color:#374151;font-size:15px;line-height:1.55;">${escapeHtml(bullet)}</li>`
    )
    .join("")

  return `<ul style="margin:8px 0 24px;padding-left:20px;">${items}</ul>`
}

function renderCustomMessage(message: string) {
  const paragraphs = paragraphsFromText(message)

  return `
    <div style="margin:0 0 24px;padding:16px 18px;background:#f7f7f7;border-left:3px solid #c7ef63;border-radius:0 8px 8px 0;">
      <p style="margin:0 0 8px;color:#151515;font-size:12px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;">Melding fra Proanbud</p>
      ${paragraphs
        .map(
          (paragraph) =>
            `<p style="margin:0 0 8px;color:#374151;font-size:14px;line-height:1.6;">${escapeHtml(paragraph)}</p>`
        )
        .join("")}
    </div>
  `
}

export function buildSellerEmailHtml(input: SellerEmailHtmlInput) {
  const logoUrl = `${appUrl()}/logo/light/logo-primary.svg`
  const headline = input.headline
    ? `<h1 style="margin:0 0 20px;color:#151515;font-size:22px;font-weight:700;line-height:1.3;letter-spacing:-0.02em;">${escapeHtml(input.headline)}</h1>`
    : ""

  const steps = input.steps?.length ? renderSteps(input.steps) : ""
  const bullets = input.bullets?.length ? renderBullets(input.bullets) : ""
  const customMessage = input.customMessage?.trim() ? renderCustomMessage(input.customMessage.trim()) : ""

  const fallbackUrl = input.fallbackUrl?.trim()
    ? `
          <p style="margin:16px 0 0;color:#6b7280;font-size:13px;line-height:1.55;">
            Fungerer ikke knappen? Kopier og lim inn denne lenken i nettleseren:
          </p>
          <p style="margin:6px 0 0;font-size:13px;line-height:1.55;word-break:break-all;">
            <a href="${escapeHtml(input.fallbackUrl.trim())}" style="color:#727272;text-decoration:underline;">${escapeHtml(input.fallbackUrl.trim())}</a>
          </p>
        `
    : ""

  const secondary = input.secondaryText
    ? `<p style="margin:16px 0 0;color:#6b7280;font-size:14px;line-height:1.55;">${escapeHtml(input.secondaryText)}</p>`
    : ""

  return `
<!DOCTYPE html>
<html lang="no">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(input.headline || LEGAL_COMPANY.product)}</title>
</head>
<body style="margin:0;padding:0;background:#f7f7f7;">
  <div style="font-family:Inter,Arial,sans-serif;background:#f7f7f7;padding:32px 16px;">
    <div style="max-width:580px;margin:0 auto;">
      <div style="background:#ffffff;border:1px solid #e8e8e8;border-radius:12px;overflow:hidden;">
        <div style="height:4px;background:linear-gradient(90deg,#151515 0%,#c7ef63 100%);"></div>
        <div style="padding:32px 32px 24px;">
          <img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(LEGAL_COMPANY.product)}" width="140" height="32" style="display:block;height:32px;width:auto;max-width:140px;margin:0 0 28px;" />
          <p style="margin:0 0 16px;color:#151515;font-size:16px;line-height:1.5;">Hei ${escapeHtml(input.recipientName)},</p>
          ${headline}
          ${renderParagraphs(input.paragraphs)}
          ${steps}
          ${bullets}
          ${customMessage}
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 0;">
            <tr>
              <td>
                <a href="${escapeHtml(input.ctaUrl)}" target="_blank" rel="noopener noreferrer" style="display:inline-block;background:#151515;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:13px 24px;border-radius:8px;">
                  ${escapeHtml(input.ctaLabel)}
                </a>
              </td>
            </tr>
          </table>
          ${fallbackUrl}
          ${secondary}
          <p style="margin:28px 0 0;color:#374151;font-size:15px;line-height:1.5;">
            Med vennlig hilsen,<br />
            <strong style="color:#151515;">${escapeHtml(LEGAL_COMPANY.product)}-teamet</strong>
          </p>
        </div>
        <div style="padding:20px 32px;background:#fafafa;border-top:1px solid #e8e8e8;">
          <p style="margin:0 0 6px;color:#9ca3af;font-size:12px;line-height:1.5;">
            Du mottar denne e-posten fra ${escapeHtml(LEGAL_COMPANY.product)} i forbindelse med kontoen din.
          </p>
          <p style="margin:0;color:#9ca3af;font-size:12px;line-height:1.5;">
            <a href="mailto:${escapeHtml(LEGAL_COMPANY.email)}" style="color:#727272;text-decoration:underline;">${escapeHtml(LEGAL_COMPANY.email)}</a>
            &nbsp;·&nbsp;
            <a href="https://proanbud.no" style="color:#727272;text-decoration:underline;">proanbud.no</a>
            &nbsp;·&nbsp;
            Org.nr. ${escapeHtml(LEGAL_COMPANY.orgNumber)}
          </p>
        </div>
      </div>
    </div>
  </div>
</body>
</html>
  `.trim()
}

export { appUrl as sellerEmailAppUrl }
