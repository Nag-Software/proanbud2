import { NextResponse } from "next/server"

import { runTripletexWorker } from "@/lib/integrations/tripletex/worker"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient as createServerSupabase } from "@/lib/supabase/server"

async function isAuthorizedWorker(request: Request) {
  const configured = process.env.INTEGRATION_WORKER_SECRET
  if (configured) {
    if (request.headers.get("x-integration-worker-secret") === configured) {
      return true
    }
  }

  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    const authHeader = request.headers.get("authorization")
    if (authHeader === `Bearer ${cronSecret}`) {
      return true
    }
  }

  const supabase = await createServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return false

  const admin = createAdminClient()
  const { data: userRow } = await admin
    .from("users")
    .select("role")
    .eq("id", user.id)
    .maybeSingle()

  return userRow?.role === "admin"
}

export async function POST(request: Request) {
  if (!(await isAuthorizedWorker(request))) {
    return NextResponse.json({ error: "Unauthorized worker" }, { status: 401 })
  }

  try {
    const body = await request.json().catch(() => ({}))
    const workerId = typeof body.workerId === "string" ? body.workerId : undefined
    const batchSize = typeof body.batchSize === "number" ? body.batchSize : undefined
    const maxBatches = typeof body.maxBatches === "number" ? body.maxBatches : undefined
    const result = await runTripletexWorker({ workerId, batchSize, maxBatches })
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
