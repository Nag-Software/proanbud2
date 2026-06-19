import { createAdminClient } from "@/lib/supabase/admin"

// Public opt-out endpoint linked from outreach emails. No auth.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const prospectId = searchParams.get("p")
  const emailParam = searchParams.get("email")?.trim().toLowerCase()

  const admin = createAdminClient()

  let email = emailParam ?? null
  let orgNumber: string | null = null

  if (prospectId) {
    const { data: prospect } = await admin
      .from("prospects")
      .select("id, email, org_number")
      .eq("id", prospectId)
      .maybeSingle()
    if (prospect) {
      email = email ?? prospect.email
      orgNumber = prospect.org_number
      await admin
        .from("prospects")
        .update({ status: "avvist", updated_at: new Date().toISOString() })
        .eq("id", prospect.id)
      await admin
        .from("prospect_outreach")
        .update({ status: "unsubscribed", updated_at: new Date().toISOString() })
        .eq("prospect_id", prospect.id)
        .in("status", ["sent", "awaiting_approval", "approved", "queued"])
    }
  }

  if (email || orgNumber) {
    await admin
      .from("outreach_unsubscribes")
      .upsert({ email, org_number: orgNumber, reason: "link" }, { onConflict: "email", ignoreDuplicates: true })
  }

  const html = `<!DOCTYPE html><html lang="no"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>Avmeldt</title></head>
  <body style="font-family:Arial,sans-serif;background:#f5f5f4;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;">
    <div style="max-width:420px;background:#fff;border:1px solid #e7e5e4;border-radius:10px;padding:32px;text-align:center;">
      <h1 style="font-size:18px;margin:0 0 8px;color:#1c1917;">Du er avmeldt</h1>
      <p style="font-size:14px;color:#78716c;margin:0;">Du vil ikke motta flere e-poster fra Proanbud. Beklager bryderiet.</p>
    </div>
  </body></html>`

  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } })
}
