import { NextResponse } from "next/server"
import { createClient as createServerSupabase } from "@/lib/supabase/server"

function getAppBaseUrl(request: Request) {
  return process.env.NEXT_PUBLIC_APP_URL?.trim() || new URL(request.url).origin
}

export async function GET(request: Request) {
  try {
    const supabase = await createServerSupabase()
    const redirectTo = process.env.MICROSOFT_REDIRECT_URI ?? `${getAppBaseUrl(request)}/api/auth/microsoft/callback`
    console.log('OAuth start (microsoft): redirectTo=', redirectTo)
    const { data, error } = await supabase.auth.signInWithOAuth({ 
      provider: "azure", 
      options: { 
        redirectTo,
        scopes: 'offline_access Calendars.ReadWrite'
      } 
    })
    console.log('OAuth start (microsoft) response:', { url: data?.url, error: error?.message })
    if (error || !data?.url) {
      return NextResponse.json({ error: error?.message ?? "failed to start oauth" }, { status: 500 })
    }
    return NextResponse.redirect(data.url)
  } catch (e) {
    return NextResponse.json({ error: "internal error" }, { status: 500 })
  }
}
