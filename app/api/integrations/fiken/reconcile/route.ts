import { NextResponse } from "next/server"

import { createAdminClient } from "@/lib/supabase/admin"
import { logServerError } from "@/lib/errors/log"
import { enqueueFikenJob } from "@/lib/integrations/fiken/jobs"
import { processFikenQueueInBackground } from "@/lib/integrations/fiken/sync"
import { isAuthorizedIntegrationWorker } from "@/lib/integrations/worker-auth"

async function runReconcile(request: Request) {
  if (!(await isAuthorizedIntegrationWorker(request))) {
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
    await logServerError({
      message: "Fiken reconcile cron failed",
      error,
      source: "worker",
      route: "POST /api/integrations/fiken/reconcile",
    })
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
