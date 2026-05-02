import { NextResponse } from "next/server"
import { createClient as createServerSupabase } from "@/lib/supabase/server"
import { revokeDocumentIntegration } from "@/lib/documents/integrations"

export async function POST(request: Request) {
  const supabase = await createServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 })
  }

  const body = await request.json()
  const provider = body?.provider

  if (provider !== "google_drive" && provider !== "onedrive") {
    return NextResponse.json({ error: "invalid_provider" }, { status: 400 })
  }

  await revokeDocumentIntegration(user.id, provider)
  return NextResponse.json({ ok: true })
}
