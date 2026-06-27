import { NextResponse } from "next/server"
import { logServerError } from "@/lib/errors/log"

export async function POST(request: Request) {
  // Google push notifications for Calendar will POST here.
  // For now we accept and respond 200. In production, validate headers and verify channel ID.
  try {
    const body = await request.text()
    // TODO: enqueue a sync job for the affected user/calendar
    return NextResponse.json({ ok: true })
  } catch (e) {
    await logServerError({
      message: "Google calendar webhook processing failed",
      error: e,
      source: "api",
      route: "POST /api/webhooks/google",
    })
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}

export async function GET(request: Request) {
  // Google may issue validation via GET for some setups; respond 200.
  return NextResponse.json({ ok: true })
}
