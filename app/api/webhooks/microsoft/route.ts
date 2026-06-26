import { NextResponse } from "next/server"
import { logServerError } from "@/lib/errors/log"

export async function POST(request: Request) {
  // Microsoft Graph subscription notifications will POST here.
  try {
    const body = await request.text()
    // TODO: verify notification, enqueue sync for the user
    return NextResponse.json({ ok: true })
  } catch (e) {
    await logServerError({
      message: "Microsoft calendar webhook processing failed",
      error: e,
      source: "api",
      route: "POST /api/webhooks/microsoft",
    })
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}

export async function GET(request: Request) {
  // Validation for subscription may require echoing validationToken
  const url = new URL(request.url)
  const token = url.searchParams.get("validationToken")
  if (token) return new Response(token, { status: 200 })
  return NextResponse.json({ ok: true })
}
