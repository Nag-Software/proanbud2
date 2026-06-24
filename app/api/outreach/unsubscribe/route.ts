import { createAdminClient } from "@/lib/supabase/admin"
import { recordUnsubscribe } from "@/lib/outreach/send"

/**
 * Suppress a prospect from all further outreach. Only ever keyed on the unguessable
 * prospect UUID — never a caller-supplied ?email= (which would let anyone suppress a
 * third-party address). State-changing, so it runs on POST only (never on a bare GET
 * that link-scanners/prefetchers would trip — see the GET handler).
 */
async function suppressProspect(prospectId: string | null): Promise<void> {
  if (!prospectId) return

  const admin = createAdminClient()
  const { data: prospect } = await admin
    .from("prospects")
    .select("id, email, org_number")
    .eq("id", prospectId)
    .maybeSingle()
  if (!prospect) return

  await admin
    .from("prospects")
    .update({ status: "avvist", updated_at: new Date().toISOString() })
    .eq("id", prospect.id)
  await admin
    .from("prospect_outreach")
    .update({ status: "unsubscribed", updated_at: new Date().toISOString() })
    .eq("prospect_id", prospect.id)
    .in("status", ["sent", "awaiting_approval", "approved", "queued"])

  await recordUnsubscribe(admin, {
    email: prospect.email,
    orgNumber: prospect.org_number,
    reason: "link",
  })
}

function page(title: string, inner: string): Response {
  const html = `<!DOCTYPE html><html lang="no"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>${title}</title></head>
  <body style="font-family:Arial,sans-serif;background:#f5f5f4;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;">
    <div style="max-width:420px;background:#fff;border:1px solid #e7e5e4;border-radius:10px;padding:32px;text-align:center;">
      ${inner}
    </div>
  </body></html>`
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } })
}

// Public opt-out endpoint linked from outreach emails. No auth.
//
// GET must NOT suppress. Corporate mail security (Microsoft Safe Links, Mimecast,
// Proofpoint …) and many clients pre-fetch every link in an email with a GET, which
// would silently opt out live prospects before a human ever reads the mail. So GET only
// renders a confirm page whose button POSTs back here; the actual suppression is on POST.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const action = `/api/outreach/unsubscribe?p=${encodeURIComponent(searchParams.get("p") ?? "")}`

  return page(
    "Meld deg av",
    `<h1 style="font-size:18px;margin:0 0 8px;color:#1c1917;">Meld deg av</h1>
       <p style="font-size:14px;color:#78716c;margin:0 0 20px;">Vil du slutte å motta e-post fra Proanbud?</p>
       <form method="POST" action="${action}">
         <button type="submit" style="display:inline-block;background:#1c1917;color:#fff;border:none;cursor:pointer;font-size:14px;font-weight:600;padding:11px 22px;border-radius:8px;">Bekreft avmelding</button>
       </form>`
  )
}

// Suppression action. Two callers:
//   • RFC 8058 one-click — Gmail/Yahoo POST `List-Unsubscribe=One-Click` here directly
//     from the native "Unsubscribe" button (no page visit); they expect a quick 2xx.
//   • The confirm page's button above (a browser form submit) — show the done page.
export async function POST(request: Request) {
  const { searchParams } = new URL(request.url)
  const rawBody = await request.text().catch(() => "")
  await suppressProspect(searchParams.get("p"))

  // One-click clients send the RFC 8058 body and want a bare 2xx, not HTML.
  if (/list-unsubscribe=one-click/i.test(rawBody)) {
    return new Response(null, { status: 200 })
  }

  return page(
    "Du er avmeldt",
    `<h1 style="font-size:18px;margin:0 0 8px;color:#1c1917;">Du er avmeldt</h1>
       <p style="font-size:14px;color:#78716c;margin:0;">Du vil ikke motta flere e-poster fra Proanbud. Beklager bryderiet.</p>`
  )
}
