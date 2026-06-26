import { NextResponse } from "next/server"

import { createClient as createServerSupabase } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { logServerError } from "@/lib/errors/log"

export async function POST() {
  try {
    const supabase = await createServerSupabase()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const admin = createAdminClient()
    const { data: userRow } = await admin
      .from("users")
      .select("company_id, role")
      .eq("id", user.id)
      .maybeSingle()

    if (!userRow?.company_id || !["admin", "manager"].includes(String(userRow.role || ""))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const { data, error } = await admin
      .from("integration_jobs")
      .update({
        status: "retry",
        next_run_at: new Date().toISOString(),
        locked_at: null,
        locked_by: null,
        updated_at: new Date().toISOString(),
      })
      .eq("company_id", userRow.company_id)
      .eq("provider", "fiken")
      .in("status", ["failed", "dead_letter"])
      .select("id")

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true, retried: data?.length || 0 })
  } catch (error) {
    await logServerError({
      message: "Fiken retry-failed jobs request failed",
      error,
      source: "api",
      route: "POST /api/integrations/fiken/retry-failed",
    })
    const message = error instanceof Error ? error.message : "Unknown error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
