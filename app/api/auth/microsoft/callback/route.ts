import { NextResponse } from "next/server"
import { createServerClient } from '@supabase/ssr'
import { createClient as createAdminClient } from '@supabase/supabase-js'

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const code = url.searchParams.get("code")
    if (!code) return NextResponse.json({ error: "missing code" }, { status: 400 })

    const pendingCookies: Array<{ name: string; value: string; options?: Record<string, unknown> }> = []

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      {
        cookies: {
          getAll() {
            return (request as Request & { cookies: { getAll(): { name: string; value: string }[] } }).cookies.getAll()
          },
          setAll(cookiesToSet) {
            pendingCookies.push(...cookiesToSet)
          },
        },
      }
    )

    const { data, error } = await supabase.auth.exchangeCodeForSession(code)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const { data: userData } = await supabase.auth.getUser()
    const user = userData?.user
    if (user) {
      const fullName = (user.user_metadata as Record<string, string | undefined>)?.full_name
        ?? (user.user_metadata as Record<string, string | undefined>)?.name
        ?? null
      const avatar = (user.user_metadata as Record<string, string | undefined>)?.avatar_url ?? null

      if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
        const supabaseAdmin = createAdminClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.SUPABASE_SERVICE_ROLE_KEY,
          { auth: { persistSession: false, autoRefreshToken: false } }
        )

        const { error: bootstrapError } = await supabaseAdmin
          .from('users')
          .upsert(
            {
              id: user.id,
              email: user.email ?? `${user.id}@no-email.local`,
              full_name: fullName ?? user.email?.split('@')[0] ?? 'Ny Bruker',
              company_id: null,
            },
            { onConflict: 'id', ignoreDuplicates: true }
          )

        if (bootstrapError) {
          console.error('OAuth callback (microsoft): users bootstrap failed', bootstrapError)
        }
      }

      if (fullName) {
        await supabase.from("users").update({ full_name: fullName }).eq("id", user.id)
      }
      await supabase.from("user_profiles").upsert({ user_id: user.id, avatar_url: avatar })

      const providerToken = data?.session?.provider_token
      const providerRefreshToken = data?.session?.provider_refresh_token

      if (providerToken) {
        await supabase.from('calendar_integrations').upsert({
          user_id: user.id,
          provider: 'microsoft',
          access_token: providerToken,
          ...(providerRefreshToken && { refresh_token: providerRefreshToken }),
        }, { onConflict: 'user_id,provider' })
      }
    }

    const redirectUrl = `${url.origin}/kalender`
    const response = NextResponse.redirect(redirectUrl)
    pendingCookies.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
    return response
  } catch (e) {
    return NextResponse.json({ error: "internal error" }, { status: 500 })
  }
}
