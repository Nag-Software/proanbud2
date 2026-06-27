import { NextResponse } from "next/server"

import { getAuthenticatedCompanyContext } from "@/lib/billing/guards"
import { syncSeatQuantity } from "@/lib/billing/sync"
import { logServerError } from "@/lib/errors/log"

export async function POST() {
  try {
    const auth = await getAuthenticatedCompanyContext()
    if (!auth.ok) return auth.response

    await syncSeatQuantity(auth.context.companyId)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("[stripe/sync-seats]", error)
    await logServerError({
      message: "Synk av ansatt-seter feilet",
      error,
      source: "api",
      route: "/api/stripe/sync-seats",
    })
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Kunne ikke synke ansatt-seter." },
      { status: 500 }
    )
  }
}
