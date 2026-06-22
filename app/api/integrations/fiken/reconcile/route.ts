import { NextResponse } from "next/server"

import { createAdminClient } from "@/lib/supabase/admin"
import { enqueueFikenJob } from "@/lib/integrations/fiken/jobs"
import { processFikenQueueInBackground } from "@/lib/integrations/fiken/sync"
import { createClient as createServerSupabase } from "@/lib/supabase/server"

async function isAuthorized(request: Request) {
  const configured = process.env.INTEGRATION_WORKER_SECRET
  if (configured && request.headers.get("x-integration-worker-secret") === configured) {
    return true
  }
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && request.headers.get("authorization") === `Bearer ${cronSecret}`) {
    return true
  }

  const supabase = await createServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return false

  const admin = createAdminClient()
  const { data: userRow } = await admin.from("users").select("role").eq("id", user.id).maybeSingle()
  return userRow?.role === "admin"
}

async function runReconcile(request: Request) {
  if (!(await isAuthorized(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const body = await request.json().catch(() => ({}))
    const companyId = typeof body.companyId === "string" ? body.companyId : null

    const admin = createAdminClient()
    const runKey = new Date().toISOString()
    const companyIds = companyId
      ? [companyId]
      : ((await admin.from("fiken_connections").select("company_id").neq("sync_state", "disconnected")).data ||
          []).map((row) => row.company_id)

    for (const id of companyIds) {
      await enqueueFikenJob({
        companyId: id,
        jobType: "reconcile.full",
        payload: { source: "cron" },
        idempotencyKey: `fiken:reconcile:${id}:${runKey}`,
      })
      await enqueueFikenJob({
        companyId: id,
        jobType: "poll_payments",
        payload: { source: "cron" },
        idempotencyKey: `fiken:poll_payments:${id}:${runKey}`,
      })
    }

    // Drain through the serialized worker (global lock prevents overlap).
    processFikenQueueInBackground({ batchSize: 5, maxBatches: 20 })

    return NextResponse.json({ ok: true, companies: companyIds.length })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(request: Request) {
  return runReconcile(request)
}

// Vercel cron issues GET requests.
export async function GET(request: Request) {
  return runReconcile(request)
}
