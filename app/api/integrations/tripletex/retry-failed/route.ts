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
        // Reset the retry budget — a dead_letter job already has attempt_count >= max_attempts,
        // so without this it would bounce straight back to dead_letter on the first re-attempt.
        attempt_count: 0,
        next_run_at: new Date().toISOString(),
        locked_at: null,
        locked_by: null,
        last_error_code: null,
        last_error_message: null,
        updated_at: new Date().toISOString(),
      })
      .eq("company_id", userRow.company_id)
      .eq("provider", "tripletex")
      .in("status", ["failed", "dead_letter"])
      // Do NOT bulk-reactivate jobs deliberately quarantined for manual review: a
      // non-idempotent create (order/invoice/customer/project) whose outcome was
      // ambiguous may already have created the entity in Tripletex, so blindly
      // re-running it would mint a duplicate. These must be checked in Tripletex and
      // retried individually. (NULL-coded rows are excluded too — the safe direction.)
      .not("last_error_code", "in", "(ambiguous_create,reaped_stuck)")
      .select("id")

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true, retried: data?.length || 0 })
  } catch (error) {
    await logServerError({
      message: "Tripletex retry-failed jobs request failed",
      error,
      source: "api",
      route: "POST /api/integrations/tripletex/retry-failed",
    })
    const message = error instanceof Error ? error.message : "Unknown error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
