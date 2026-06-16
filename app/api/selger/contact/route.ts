import { NextResponse } from "next/server"

import { logSellerActivity } from "@/lib/selger/activity-log"
import { requirePlatformSellerForApi } from "@/lib/auth/require-platform-seller-api"
import { createAdminClient } from "@/lib/supabase/admin"

export async function POST(request: Request) {
  const auth = await requirePlatformSellerForApi()
  if (auth.error) return auth.error

  try {
    const { company_id, phone } = await request.json()

    if (!company_id) {
      return NextResponse.json({ error: "Firma mangler" }, { status: 400 })
    }

    const admin = createAdminClient()
    const now = new Date().toISOString()

    const { data: company, error } = await admin
      .from("companies")
      .update({
        seller_last_contacted_at: now,
        seller_contact_status: "kontaktet",
      })
      .eq("id", company_id)
      .select("id, name, phone")
      .maybeSingle()

    if (error || !company) {
      return NextResponse.json({ error: "Firmaet finnes ikke" }, { status: 404 })
    }

    await logSellerActivity({
      sellerUserId: auth.user!.id,
      action: "phone_call",
      targetType: "company",
      targetId: company_id,
      metadata: {
        companyId: company_id,
        companyName: company.name,
        phone: phone || company.phone,
      },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("POST /api/selger/contact", error)
    return NextResponse.json({ error: "Intern serverfeil" }, { status: 500 })
  }
}
