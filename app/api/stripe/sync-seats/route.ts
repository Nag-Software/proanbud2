import { NextResponse } from "next/server"

import { getAuthenticatedCompanyContext } from "@/lib/billing/guards"
import { syncSeatQuantity } from "@/lib/billing/sync"

export async function POST() {
  try {
    const auth = await getAuthenticatedCompanyContext()
    if (!auth.ok) return auth.response

    await syncSeatQuantity(auth.context.companyId)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("[stripe/sync-seats]", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Kunne ikke synke ansatt-seter." },
      { status: 500 }
    )
  }
}
