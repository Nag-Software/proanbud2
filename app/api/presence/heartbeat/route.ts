import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"

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

    await supabase
      .from("users")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("id", user.id)
  } catch (error) {
    console.error("[presence/heartbeat]", error)
  }
  return new NextResponse(null, { status: 204 })
}
