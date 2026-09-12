import { NextResponse } from "next/server"
import { z } from "zod"

import { createAdminClient } from "@/lib/supabase/admin"
import { logServerError } from "@/lib/errors/log"
import type { ProspectRow } from "@/lib/outreach/types"

export const maxDuration = 15

/**
 * Offentlig beacon for ekte klikk.
 *
 * Hvorfor ikke Resend-sporing: lenkeskannere (Microsoft Safe Links, Gmails
 * proxy, antivirus i gateway) åpner og klikker på alt i en e-post før den
 * vises. Et GET-klikk sier derfor ingenting om mennesket. En beacon som først
 * fyres etter at siden har vært synlig i tre sekunder, eller ved en faktisk
 * interaksjon, kan en skanner ikke etterligne.
 *
 * Et klikk STOPPER ikke sekvensen (planens punkt 5). Det gir varm status og en
 * oppgave — bare et svar stopper.
 */
const schema = z.object({
  /** prospects.tracking_token fra ?r= i lenken. */
  token: z.string().min(6).max(32),
  event: z.enum(["visning", "interaksjon"]),
  /** Millisekunder siden siden ble synlig. */
  dwell_ms: z.number().int().min(0).max(3_600_000).optional(),
})

/** Kjente lenkeskannere og roboter. Aldri et menneske. */
const SCANNER = /(bot|crawler|spider|preview|scanner|monitor|curl|wget|python-requests|headless|safelinks|proofpoint|mimecast|barracuda)/i

/** Under dette er «visning» ikke et menneske som leser. */
const MIN_DWELL_MS = 3000

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ ok: false }, { status: 400 })
  }

  const userAgent = request.headers.get("user-agent") ?? ""
  if (SCANNER.test(userAgent)) {
    // Svar 200: en skanner skal ikke få vite at den ble avvist, og siden skal
    // ikke se ut som den feiler.
    return NextResponse.json({ ok: true, counted: false })
  }

  const { token, event, dwell_ms: dwell } = parsed.data
  const real = event === "interaksjon" || (dwell ?? 0) >= MIN_DWELL_MS
  if (!real) return NextResponse.json({ ok: true, counted: false })

  try {
    const admin = createAdminClient()
    const { data: prospect } = await admin
      .from("prospects")
      .select("id, name, click_count, is_hot, status")
      .eq("tracking_token", token)
      .maybeSingle<Pick<ProspectRow, "id" | "name" | "click_count" | "is_hot" | "status">>()

    if (!prospect) return NextResponse.json({ ok: true, counted: false })

    const now = new Date().toISOString()

    await admin
      .from("prospects")
      .update({
        click_count: (prospect.click_count ?? 0) + 1,
        is_hot: true,
        hot_since: prospect.is_hot ? undefined : now,
        last_activity_at: now,
        updated_at: now,
      })
      .eq("id", prospect.id)

    // Én åpen oppgave om gangen (unik indeks i db/66). Finnes det allerede en,
    // er den Caspers, og vi overstyrer den ikke.
    const { data: openTask } = await admin
      .from("prospect_tasks")
      .select("id")
      .eq("prospect_id", prospect.id)
      .is("done_at", null)
      .maybeSingle()

    if (!openTask) {
      await admin.from("prospect_tasks").insert({
        prospect_id: prospect.id,
        task_type: "ring",
        title: "Klikket på lenken — ring mens det er ferskt",
        due_at: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
      })
    }

    return NextResponse.json({ ok: true, counted: true })
  } catch (error) {
    await logServerError({
      message: "Beacon for klikk feilet",
      error,
      level: "warning",
      source: "api",
      route: "POST /api/outreach/engagement",
    })
    // Feilen er vår, ikke leserens. Siden skal ikke vise noe galt.
    return NextResponse.json({ ok: true, counted: false })
  }
}
