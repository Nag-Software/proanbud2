import { NextResponse } from "next/server"
import { createClient as createServerSupabase } from "@/lib/supabase/server"
import { revokeIntegration } from "@/lib/oauth"

export async function DELETE(request: Request) {
  const supabase = await createServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const provider = new URL(request.url).searchParams.get("provider")
  if (provider !== "google" && provider !== "microsoft") {
    return NextResponse.json({ error: "Invalid provider" }, { status: 400 })
  }

  await revokeIntegration(user.id, provider)
  return NextResponse.json({ ok: true })
}
