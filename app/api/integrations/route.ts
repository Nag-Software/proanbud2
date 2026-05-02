import { NextResponse } from "next/server"
import { createClient as createServerSupabase } from "@/lib/supabase/server"

export async function GET(request: Request) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ integrations: [] })

  const { data: userRow } = await supabase
    .from("users")
    .select("company_id")
    .eq("id", user.id)
    .maybeSingle()

  const [{ data }, { data: tripletex }] = await Promise.all([
    supabase
    .from("calendar_integrations")
    .select("provider,expires_at,scope,created_at,updated_at")
    .eq("user_id", user.id),
    userRow?.company_id
      ? supabase
          .from("tripletex_connections")
          .select("company_id,sync_state,last_success_at,last_error_at,last_error_message")
          .eq("company_id", userRow.company_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  return NextResponse.json({ integrations: data ?? [], tripletex: tripletex || null })
}
