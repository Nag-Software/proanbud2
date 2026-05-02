import { NextResponse } from "next/server"
import { createClient as createServerSupabase } from "@/lib/supabase/server"

export async function GET() {
  const supabase = await createServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ integrations: [] })
  }

  const { data } = await supabase
    .from("document_integrations")
    .select("provider,scope,expires_at,account_email,account_name,created_at,updated_at")
    .eq("user_id", user.id)
    .order("provider", { ascending: true })

  return NextResponse.json({ integrations: data ?? [] })
}
