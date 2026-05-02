import { NextResponse } from "next/server"
import { createServerClient } from '@supabase/ssr'
import { createClient as createAdminClient } from '@supabase/supabase-js'

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const code = url.searchParams.get("code")
    if (!code) return NextResponse.json({ error: "missing code" }, { status: 400 })

    // collect cookies that the Supabase client wants to set (session cookie)
    const pendingCookies: Array<{ name: string; value: string; options?: any }> = []

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      {
        cookies: {
          getAll() {
            return (request as any).cookies.getAll()
          },
          setAll(cookiesToSet: any[]) {
            pendingCookies.push(...cookiesToSet)
          },
        },
      }
    )

    console.log('OAuth callback (google): code=', code)
    // Exchange the code for a session
    const { data, error } = await supabase.auth.exchangeCodeForSession(code)
    console.log('OAuth callback (google) exchange result:', { session: data?.session, error: error?.message })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // fetch the user and ensure a profile exists in our DB
    const { data: userData } = await supabase.auth.getUser()
    const user = userData?.user
    console.log('OAuth callback (google): user after exchange', user?.id ?? null)
    if (user) {
      const fullName = (user.user_metadata as any)?.full_name ?? (user.user_metadata as any)?.name ?? null
      const avatar = (user.user_metadata as any)?.avatar_url ?? null

      // Best effort bootstrap: ensure users row exists even before company is created.
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
            { onConflict: 'id' }
          )

        if (bootstrapError) {
          console.error('OAuth callback (google): users bootstrap failed', bootstrapError)
        }
      }

      if (fullName) {
        await supabase.from("users").update({ full_name: fullName }).eq("id", user.id)
      }
      const upsertRes = await supabase.from("user_profiles").upsert({ user_id: user.id, avatar_url: avatar })
      console.log('OAuth callback (google): upsert profile result', upsertRes)

      const providerToken = data?.session?.provider_token
      const providerRefreshToken = data?.session?.provider_refresh_token
      
      if (providerToken) {
        // Upsert calendar_integrations
        const { error: insertError } = await supabase.from('calendar_integrations').upsert({
          user_id: user.id,
          provider: 'google',
          access_token: providerToken,
          ...(providerRefreshToken && { refresh_token: providerRefreshToken }),
        }, { onConflict: 'user_id,provider' })
        
        console.log('OAuth callback (google): upsert integration result', insertError)
      }
    }

    // On success, redirect to kalender and attach any cookies set by Supabase
    const redirectUrl = `${url.origin}/kalender`
    const response = NextResponse.redirect(redirectUrl)
    pendingCookies.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
    return response
  } catch (e) {
    console.error('OAuth callback (google) error:', e)
    const message = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: message ?? "internal error" }, { status: 500 })
  }
}
