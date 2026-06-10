import { createClient as createServerSupabase } from "@/lib/supabase/server"
import type { OAuthTokenResult } from "./oauth-flow"

export async function upsertCalendarIntegration(
  userId: string,
  provider: "google" | "microsoft",
  tokens: OAuthTokenResult
) {
  const supabase = await createServerSupabase()

  const { data: existing } = await supabase
    .from("calendar_integrations")
    .select("refresh_token")
    .eq("user_id", userId)
    .eq("provider", provider)
    .maybeSingle()

  const refreshToken = tokens.refresh_token ?? existing?.refresh_token ?? null

  const { error } = await supabase.from("calendar_integrations").upsert(
    {
      user_id: userId,
      provider,
      access_token: tokens.access_token,
      refresh_token: refreshToken,
      expires_at: tokens.expires_at,
      scope: tokens.scope ?? null,
    },
    { onConflict: "user_id,provider" }
  )

  if (error) {
    throw new Error(error.message)
  }
}
