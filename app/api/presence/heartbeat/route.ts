import { NextResponse } from "next/server"

import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { logServerError } from "@/lib/errors/log"

// Lightweight presence ping. The authenticated app shell calls this on a timer
// so Sjefen → Analyse can show a live active-user count and map. Best-effort:
// failures are swallowed so a missing migration never breaks the app.
export async function POST() {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return new NextResponse(null, { status: 204 })
    }

    // last_seen_at er ikke skrivbar for rollen `authenticated` (db/80), så
    // pinget går via service_role – låst til den verifiserte sesjonens egen id.
    await createAdminClient()
      .from("users")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("id", user.id)
  } catch (error) {
    console.error("[presence/heartbeat]", error)
    await logServerError({
      message: "Presence-heartbeat feilet",
      error,
      source: "api",
      route: "app/api/presence/heartbeat/route.ts",
      level: "warning",
    })
  }
  return new NextResponse(null, { status: 204 })
}
