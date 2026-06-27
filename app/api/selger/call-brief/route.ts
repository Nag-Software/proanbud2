import { NextResponse } from "next/server"
import { z } from "zod"

import { requirePlatformSellerForApi } from "@/lib/auth/require-platform-seller-api"
import { generateCallBrief } from "@/lib/selger/call-brief"

// AI call-brief for a hot prospect. Drives the CallDrawer in the seller cockpit.
export const maxDuration = 30

const schema = z.object({ prospectId: z.string().uuid() })

export async function POST(request: Request) {
  const auth = await requirePlatformSellerForApi()
  if (auth.error) return auth.error

  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "Ugyldig forespørsel" }, { status: 400 })
  }

  const brief = await generateCallBrief(parsed.data.prospectId)
  if (!brief) return NextResponse.json({ error: "Fant ikke prospekt" }, { status: 404 })

  return NextResponse.json({ brief })
}
