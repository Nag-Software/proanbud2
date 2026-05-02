import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { checkRoleAccess } from "@/lib/auth-utils"

export async function POST(req: Request) {
  try {
    const supabase = await createClient()
    const { user } = await checkRoleAccess(["admin", "manager"])
    
    // get company id
    const { data: userRow } = await supabase
      .from("users")
      .select("company_id")
      .eq("id", user.id)
      .single()

    if (!userRow?.company_id) {
      return NextResponse.json({ error: "No company found" }, { status: 400 })
    }

    const { provider } = await req.json()

    if (provider !== "docusign" && provider !== "tripletex" && provider !== null) {
      return NextResponse.json({ error: "Invalid provider" }, { status: 400 })
    }

    const { error } = await supabase
      .from("companies")
      .update({ contract_provider: provider })
      .eq("id", userRow.company_id)

    if (error) throw error

    return NextResponse.json({ success: true, provider })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
