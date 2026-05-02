import { NextResponse } from "next/server"
import { createClient as createServerSupabase } from "@/lib/supabase/server"

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const redirectTo = process.env.ONEDRIVE_REDIRECT_URI ?? `${url.origin}/api/auth/onedrive/callback`
    const supabase = await createServerSupabase()

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "azure",
      options: {
        redirectTo,
        scopes: "offline_access Files.ReadWrite User.Read",
      },
    })

    if (error || !data?.url) {
      return NextResponse.json({ error: error?.message ?? "failed_to_start_oauth" }, { status: 500 })
    }

    return NextResponse.redirect(data.url)
  } catch (e) {
    const message = e instanceof Error ? e.message : "internal_error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
