import { NextResponse } from "next/server"

import { logSellerActivity } from "@/lib/selger/activity-log"
import { requirePlatformSellerForApi } from "@/lib/auth/require-platform-seller-api"
import { createAdminClient } from "@/lib/supabase/admin"
import type { SellerContactStatus } from "@/lib/selger/types"

const validStatuses: SellerContactStatus[] = [
  "ukontaktet",
  "kontaktet",
  "oppfolging",
  "demo",
  "kunde",
  "avslaatt",
]

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requirePlatformSellerForApi()
  if (auth.error) return auth.error

  try {
    const { id } = await params
    const { contact_status } = await request.json()

    if (!validStatuses.includes(contact_status)) {
      return NextResponse.json({ error: "Ugyldig kontaktstatus" }, { status: 400 })
    }

    const admin = createAdminClient()
    const now = new Date().toISOString()
    const touchContact = contact_status !== "ukontaktet"

    const { data, error } = await admin
      .from("companies")
      .update({
        seller_contact_status: contact_status,
        seller_last_contacted_at: touchContact ? now : null,
      })
      .eq("id", id)
      .select("id, name")
      .maybeSingle()

    if (error || !data) {
      return NextResponse.json({ error: "Firmaet finnes ikke" }, { status: 404 })
    }

    await logSellerActivity({
      sellerUserId: auth.user!.id,
      action: "update_contact_status",
      targetType: "company",
      targetId: id,
      metadata: {
        companyId: id,
        companyName: data.name,
        contact_status,
      },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("PATCH /api/selger/companies/[id]", error)
    return NextResponse.json({ error: "Intern serverfeil" }, { status: 500 })
  }
}
