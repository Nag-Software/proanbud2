// HTML wrapper for outreach emails. Includes a clear call-to-action button,
// sender identity, and an unsubscribe link — required by markedsføringsloven /
// GDPR for cold B2B email.

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

function bodyToHtml(bodyText: string): string {
  return bodyText
    .trim()
    .split(/\n{2,}/)
    .map((para) => `<p style="margin:0 0 14px;">${escapeHtml(para).replaceAll("\n", "<br/>")}</p>`)
    .join("")
}

/**
 * Bunntekst for ren tekst-utsending.
 *
 * Kald e-post i ren tekst leveres bedre enn HTML med knapp og bilder, og den
 * ser ut som noe et menneske har skrevet — som er hele poenget. Bunnteksten må
 * likevel ha avsenderidentitet, hvor adressen kom fra og en avmeldingslenke
 * (markedsføringsloven § 15, GDPR art. 14).
 */
export function buildOutreachPlaintextFooter(args: {
  unsubscribeUrl: string
  /** Hvor vi fant adressen — «Brønnøysundregistrene» eller «nettsiden deres». */
  sourceLabel?: string
  /**
   * Grunnlaget for e-posten. «kald»: berettiget interesse overfor en
   * firmaadresse. «samtykke»: de laget et eksempeltilbud og sa ja til
   * oppfølging — da er det det bunnteksten skal si, ikke hvor adressen kom fra.
   */
  reason?: "kald" | "samtykke"
}): string {
  const why =
    args.reason === "samtykke"
      ? "Du får denne e-posten fordi du laget et eksempeltilbud på proanbud.no og sa ja til at vi kunne følge opp."
      : `Du får denne e-posten fordi bedriften er registrert i bygg- og anleggsbransjen. Adressen er hentet fra ${args.sourceLabel || "Brønnøysundregistrene"}.`
  return [
    "--",
    "Proanbud — utviklet av Nag Software, Sydhøyveien 1, 3084 Holmestrand (org.nr. 936593127).",
    why,
    `Vil du ikke ha flere e-poster: ${args.unsubscribeUrl}`,
  ].join("\n")
}

/** Hele e-posten som ren tekst, klar til sending. */
export function buildOutreachPlaintext(args: {
  bodyText: string
  unsubscribeUrl: string
  sourceLabel?: string
  reason?: "kald" | "samtykke"
}): string {
  return `${args.bodyText.trim()}\n\n${buildOutreachPlaintextFooter(args)}\n`
}

export function buildOutreachEmailHtml(args: {
  bodyText: string
  unsubscribeUrl: string
  ctaUrl?: string
  ctaLabel?: string
}): string {
  const ctaLabel = args.ctaLabel || "Prøv Proanbud gratis i 14 dager"
  const ctaBlock = args.ctaUrl
    ? `<div style="margin:22px 0 8px;">
         <a href="${escapeHtml(args.ctaUrl)}" target="_blank" rel="noopener noreferrer" style="display:inline-block;background:#1c1917;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 22px;border-radius:8px;">${escapeHtml(ctaLabel)}</a>
       </div>`
    : ""

  return `
  <div style="font-family:Arial,Helvetica,sans-serif;background:#f5f5f4;padding:24px;">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e7e5e4;border-radius:10px;padding:28px;">
      <div style="font-size:15px;line-height:1.6;color:#1c1917;">
        ${bodyToHtml(args.bodyText)}
      </div>
      ${ctaBlock}
      <hr style="border:none;border-top:1px solid #e7e5e4;margin:24px 0 14px;" />
      <p style="margin:0;font-size:12px;line-height:1.5;color:#78716c;">
        Proanbud — utviklet av Nag Software, Sydhøyveien 1, 3084 Holmestrand (org.nr. 936593127).<br/>
        Du mottar denne e-posten fordi bedriften din er i bygg- og anleggsbransjen.
        <a href="${escapeHtml(args.unsubscribeUrl)}" style="color:#78716c;">Meld deg av</a>.
      </p>
    </div>
  </div>`.trim()
}
