// HTML wrapper for outreach emails. Includes clear sender identity and an
// unsubscribe link — required by markedsføringsloven / GDPR for cold B2B email.

function escapeHtml(value: string): string {
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

export function buildOutreachEmailHtml(args: { bodyText: string; unsubscribeUrl: string }): string {
  return `
  <div style="font-family:Arial,Helvetica,sans-serif;background:#f5f5f4;padding:24px;">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e7e5e4;border-radius:10px;padding:28px;">
      <div style="font-size:15px;line-height:1.6;color:#1c1917;">
        ${bodyToHtml(args.bodyText)}
      </div>
      <hr style="border:none;border-top:1px solid #e7e5e4;margin:24px 0 14px;" />
      <p style="margin:0;font-size:12px;line-height:1.5;color:#78716c;">
        Proanbud — utviklet av Nag Software, Holmestrand (org.nr. 936593127).<br/>
        Du mottar denne e-posten fordi bedriften din er i bygg- og anleggsbransjen.
        <a href="${escapeHtml(args.unsubscribeUrl)}" style="color:#78716c;">Meld deg av</a>.
      </p>
    </div>
  </div>`.trim()
}
