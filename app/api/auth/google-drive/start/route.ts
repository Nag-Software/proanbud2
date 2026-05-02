import { NextResponse } from "next/server"
import { createClient as createServerSupabase } from "@/lib/supabase/server"

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const redirectTo = process.env.GOOGLE_DRIVE_REDIRECT_URI ?? `${url.origin}/api/auth/google-drive/callback`
    const supabase = await createServerSupabase()

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo,
        queryParams: {
          access_type: "offline",
          prompt: "consent",
        },
        scopes: "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/userinfo.email",
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
