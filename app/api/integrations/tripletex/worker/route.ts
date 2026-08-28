import { NextResponse } from "next/server"

import { runTripletexWorker } from "@/lib/integrations/tripletex/worker"
import { isAuthorizedIntegrationWorker } from "@/lib/integrations/worker-auth"
import { logServerError } from "@/lib/errors/log"

export async function POST(request: Request) {
  if (!(await isAuthorizedIntegrationWorker(request))) {
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
    await logServerError({
      message: "Tripletex worker run failed",
      error,
      source: "worker",
      route: "POST /api/integrations/tripletex/worker",
    })
    const message = error instanceof Error ? error.message : "Unknown error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
