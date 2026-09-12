import { NextResponse } from "next/server"
import { z } from "zod"

import { requirePlatformSellerForApi } from "@/lib/auth/require-platform-seller-api"
import { logSellerActivity } from "@/lib/selger/activity-log"
import { discoverAccountants, importAccountants } from "@/lib/outreach/partner"

export const maxDuration = 120

/** Mållista, uten å importere noe. */
export async function GET(request: Request) {
  const auth = await requirePlatformSellerForApi()
  if (auth.error) return auth.error

  const { searchParams } = new URL(request.url)
  const minClients = Math.max(1, Number(searchParams.get("min")) || 2)
  return NextResponse.json({ accountants: await discoverAccountants({ minClients }) })
}

const schema = z.object({
  limit: z.number().int().min(1).max(50).optional(),
  minClients: z.number().int().min(1).max(50).optional(),
})

/** Meld de beste kontorene inn som prospekter i partnersegmentet. */
export async function POST(request: Request) {
  const auth = await requirePlatformSellerForApi()
  if (auth.error) return auth.error

  const parsed = schema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: "Ugyldig forespørsel" }, { status: 400 })
  }

  const summary = await importAccountants({
    limit: parsed.data.limit ?? 20,
    minClients: parsed.data.minClients ?? 2,
  })

  await logSellerActivity({
    sellerUserId: auth.user!.id,
    action: "import_partners",
    targetType: "prospects",
    metadata: summary,
  })

  return NextResponse.json(summary)
}
