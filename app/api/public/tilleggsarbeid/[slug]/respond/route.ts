import { NextResponse } from "next/server"
import { z } from "zod"

import { createAdminClient } from "@/lib/supabase/admin"
import { fetchPublicChangeOrderBySlug } from "@/lib/tilleggsarbeid/change-order"

const schema = z.object({ action: z.enum(["accept", "reject"]) })

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params

  const co = await fetchPublicChangeOrderBySlug(slug)
  if (!co) return NextResponse.json({ error: "Finnes ikke" }, { status: 404 })
  if (!co.canRespond) return NextResponse.json({ error: "Allerede besvart" }, { status: 409 })

  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Ugyldig forespørsel" }, { status: 400 })

  const nextStatus = parsed.data.action === "accept" ? "accepted" : "rejected"
  const admin = createAdminClient()

  // Race-sikret: kun side-effekt-fri statusflipp, og kun når raden faktisk var 'sent'.
  const { data: updated, error } = await admin
    .from("change_orders")
    .update({ status: nextStatus, customer_responded_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", co.id)
    .eq("status", "sent")
    .select("id")
  if (error) return NextResponse.json({ error: "Kunne ikke lagre svaret" }, { status: 500 })
  if (!updated || updated.length === 0) {
    return NextResponse.json({ ok: true, status: nextStatus, alreadyResponded: true })
  }

  return NextResponse.json({ ok: true, status: nextStatus })
}
