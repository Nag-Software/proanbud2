import { NextResponse } from "next/server"

import { createAdminClient } from "@/lib/supabase/admin"
import { enqueueIntegrationJob } from "@/lib/integrations/tripletex/jobs"
import { createClient as createServerSupabase } from "@/lib/supabase/server"

async function isAuthorized(request: Request) {
  const configured = process.env.INTEGRATION_WORKER_SECRET
  if (configured) {
    return request.headers.get("x-integration-worker-secret") === configured
  }

  const supabase = await createServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  return Boolean(user)
}

export async function POST(request: Request) {
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
      : ((await admin.from("tripletex_connections").select("company_id")).data || []).map((row) => row.company_id)

    for (const id of companyIds) {
      await enqueueIntegrationJob({
        companyId: id,
        jobType: "customer.pull_all",
        payload: { scope: "nightly" },
        idempotencyKey: `customer:pull_all:${id}:${runKey}`,
      })

      await enqueueIntegrationJob({
        companyId: id,
        jobType: "reconcile.full",
        payload: { scope: "nightly" },
        idempotencyKey: `reconcile:${id}:${runKey}`,
      })
    }

    return NextResponse.json({ ok: true, companies: companyIds.length })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
