import { NextResponse } from "next/server"
import { z } from "zod"

import { isAffiliateStatus, updateAffiliatePartner } from "@/lib/affiliate/queries"

/**
 * Update a seller's status or internal notes from /sjefen/selgere.
 * Platform-admin access is enforced by the middleware on /api/sjefen/:path*.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const patchSchema = z.object({
  status: z.string().refine(isAffiliateStatus, "Ugyldig status").optional(),
  notes: z.string().max(5000).optional(),
})

type RouteParams = { params: Promise<{ id: string }> }

export async function PATCH(request: Request, { params }: RouteParams) {
  const { id } = await params
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "Ugyldig id." }, { status: 400 })
  }

  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json({ error: "Ugyldig forespørsel." }, { status: 400 })
  }

  const parsed = patchSchema.safeParse(payload)
  if (!parsed.success) {
    return NextResponse.json({ error: "Ugyldige felt." }, { status: 400 })
  }

  try {
    await updateAffiliatePartner(id, {
      status: parsed.data.status,
      notes: parsed.data.notes,
    })
  } catch (error) {
    console.error("Failed to update affiliate partner:", error)
    return NextResponse.json({ error: "Kunne ikke oppdatere." }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
